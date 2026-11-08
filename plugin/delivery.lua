-- Durable, strictly ordered delivery of the on-disk outbox. One call to step()
-- performs at most one HTTP request. A packet is deleted only after a response
-- that matches that exact packet; every other outcome keeps it and the same bytes
-- are sent again. Hooks that apply an acknowledgement must be idempotent: a crash
-- between the hook and the delete resends the packet and the server answers duplicate.
local json = require("wire_json")
local codec = require("codec")
local M = {}
local DEFAULT_LIMITS = {direct_bytes = 1048576, chunk_bytes = 1048576, envelope_bytes = 16777216}
local BACKOFF = {5, 15, 60, 300}
local MAX_RETRY_AFTER = 3600
local HOOK_ATTEMPTS = 5
-- Pauses that depend on the saved settings clear themselves when those change.
local SETTINGS_PAUSES = {token_rejected = true, forbidden = true, instance_mismatch = true, device_mismatch = true,
    server_changed = true, policy_changed = true, generation_regressed = true}
local ACK_KEYS = {schema_version = true, instance_id = true, device_id = true, reset_generation = true, source_id = true,
    seq = true, kind = true, status = true, results = true, current_reset_generation = true}

-- The scope within which an acknowledgement body counts as authentic: only the
-- exact bytes of a response that was just matched against its packet.
function M.authenticator()
    local current
    return {
        verify = function(bytes) return current ~= nil and bytes == current end,
        within = function(bytes, work)
            current = bytes
            local ok, result = pcall(work)
            current = nil
            if not ok then error(result, 0) end
            return result
        end,
    }
end

local function whole(value) return type(value) == "number" and value == math.floor(value) and value >= 0 and value <= 9007199254740991 end

local function result_keys(packet)
    local keys, payload = {}, packet.payload
    if packet.kind == "reading_events" then
        for _, event in ipairs(payload.events) do keys[#keys + 1] = event.event_id end
    elseif packet.kind == "source_snapshot" then
        for _, name in ipairs({"metadata", "annotations", "progress"}) do
            if payload[name] ~= nil then keys[#keys + 1] = name end
        end
    else keys[1] = packet.kind end
    return keys
end

-- Returns "applied" or "obsolete" for an acknowledgement that matches the packet
-- in every identity field and result key, otherwise nil.
local function acknowledged(ack, packet)
    if type(ack) ~= "table" then return nil end
    for key in pairs(ack) do if not ACK_KEYS[key] then return nil end end
    if ack.schema_version ~= 1 or ack.instance_id ~= packet.instance_id or ack.device_id ~= packet.device_id
        or ack.source_id ~= packet.source_id or ack.reset_generation ~= packet.reset_generation
        or ack.seq ~= packet.seq or ack.kind ~= packet.kind or type(ack.results) ~= "table"
        or not whole(ack.current_reset_generation) then return nil end
    local expected = result_keys(packet)
    local count = 0
    for _ in pairs(ack.results) do count = count + 1 end
    if count ~= #expected then return nil end
    local obsolete = ack.status == "obsolete_discarded"
    if not obsolete and ack.status ~= "applied" and ack.status ~= "duplicate" then return nil end
    for _, key in ipairs(expected) do
        local result = ack.results[key]
        if obsolete then
            if result ~= "discarded" then return nil end
        elseif result == "stale" then
            if packet.kind == "reading_events" then return nil end
        elseif result ~= "applied" and result ~= "duplicate" then return nil end
    end
    if obsolete then
        if ack.current_reset_generation <= packet.reset_generation then return nil end
    elseif ack.current_reset_generation ~= packet.reset_generation then return nil end
    return obsolete and "obsolete" or "applied"
end
M.acknowledged = acknowledged

local function error_code(response)
    local ok, body = pcall(codec.decode, response.body)
    local err = ok and type(body) == "table" and type(body.error) == "table" and body.error.code
    return type(err) == "string" and err:match("^[%w_%-]+$") and #err <= 64 and err or nil
end

-- opts: store, transport, clock, auth (M.authenticator()), hooks {apply, obsolete},
-- sha256 (hex of a string), tag (settings fingerprint), instance_id, device_id, warn,
-- limits (the profile's direct/chunk/envelope byte limits).
function M.new(opts)
    local store, transport, clock = opts.store, opts.transport, opts.clock
    assert(store and transport and type(clock) == "function" and opts.auth and type(opts.hooks) == "table", "delivery dependencies unavailable")
    local self = {}
    local limits = opts.limits or DEFAULT_LIMITS
    local DIRECT, CHUNK, ENVELOPE = limits.direct_bytes, limits.chunk_bytes, limits.envelope_bytes
    local decoded_head
    local function warn(...) if opts.warn then pcall(opts.warn, ...) end end
    local function load()
        local raw = store:get("outbox_meta")
        if not raw then return {v = 1, attempts = 0} end
        local ok, meta = pcall(codec.decode, raw)
        if ok and type(meta) == "table" then return meta end
        return {v = 1, attempts = 0}
    end
    local function save(meta) store:transaction(function(tx) tx:put("outbox_meta", codec.encode(meta)) end) end
    local function pause(meta, reason, code)
        meta.pause = {reason = reason, code = code or json.null, tag = opts.tag or json.null}
        meta.next_at = nil
        save(meta)
        return "paused"
    end
    local function retry(meta, now, response, code)
        meta.attempts = (meta.attempts or 0) + 1
        local delay = BACKOFF[math.min(meta.attempts, #BACKOFF)]
        local after = response and response.headers and tonumber(response.headers["retry-after"])
        if after and after == math.floor(after) and after > delay then delay = math.min(after, MAX_RETRY_AFTER) end
        meta.delay, meta.next_at, meta.last_error = delay, now + delay, code
        save(meta)
        return "retry"
    end
    -- A clock that moved backwards never extends a wait beyond the schedule.
    local function due(meta, now)
        if meta.next_at == nil or now >= meta.next_at then return true end
        return meta.next_at - now > (meta.delay or 0)
    end
    local function complete(seq, bytes, now)
        store:transaction(function(tx)
            local head, stored = store:outbox_head()
            assert(head == seq and stored == bytes, "outbox head changed")
            tx:dequeue(seq)
            tx:put("outbox_meta", codec.encode({v = 1, attempts = 0, last_ok = now}))
        end)
    end

    function self:status()
        local meta = load()
        return {queue = store:outbox_count(), paused = meta.pause and meta.pause.reason or nil,
            code = meta.pause and meta.pause.code ~= json.null and meta.pause.code or nil,
            next_at = meta.next_at, last_ok = meta.last_ok, last_error = meta.last_error}
    end
    -- Stops delivery for a reason found outside the queue (for example a server
    -- whose identity differs); only resume() or a settings change clears it.
    function self:hold(reason, code) pause(load(), reason, code) end
    function self:resume()
        local meta = load()
        save({v = 1, attempts = 0, last_ok = meta.last_ok})
    end

    local function request(meta, seq, bytes, packet)
        if not meta.force_upload and #bytes <= DIRECT then return transport:post_sync(bytes), "direct" end
        local upload = meta.upload
        if not upload or upload.seq ~= seq or upload.bytes ~= #bytes then
            local manifest = {schema_version = 1, instance_id = packet.instance_id, device_id = packet.device_id,
                reset_generation = packet.reset_generation, source_id = packet.source_id, seq = seq, kind = packet.kind,
                byte_length = #bytes, sha256 = opts.sha256(bytes), chunk_count = math.ceil(#bytes / CHUNK)}
            return transport:create_upload(json.encode(manifest)), "create"
        end
        if upload.next < math.ceil(#bytes / CHUNK) then
            return transport:put_chunk(upload.id, upload.next, bytes:sub(upload.next * CHUNK + 1, (upload.next + 1) * CHUNK)), "chunk"
        end
        return transport:commit(upload.id), "commit"
    end

    local function accept(meta, now, seq, bytes, packet, response)
        local ok, ack = pcall(codec.decode, response.body)
        local outcome = ok and acknowledged(ack, packet)
        if not outcome then return retry(meta, now, response, "bad_ack") end
        local applied = pcall(function()
            if outcome == "applied" then
                if opts.hooks.apply then opts.auth.within(response.body, function() opts.hooks.apply(packet, response.body) end) end
            elseif opts.hooks.obsolete then opts.hooks.obsolete(ack.current_reset_generation) end
        end)
        if not applied then
            warn("acknowledgement hook failed for seq", seq)
            if (meta.attempts or 0) + 1 >= HOOK_ATTEMPTS then return pause(meta, "hook_failed") end
            return retry(meta, now, nil, "hook_failed")
        end
        complete(seq, bytes, now)
        return "sent"
    end

    local function handle(meta, now, seq, bytes, packet, response, phase)
        if response.error then return retry(meta, now, nil, "network") end
        local status = response.status
        if status >= 200 and status < 300 then
            if phase == "create" then
                local ok, created = pcall(codec.decode, response.body)
                local id = ok and type(created) == "table" and created.upload_id
                if status ~= 201 or type(id) ~= "string" or not id:match("^[%x%-]+$") or #id ~= 36 then return retry(meta, now, response, "bad_upload") end
                meta.upload = {id = id, seq = seq, bytes = #bytes, next = 0}
            elseif phase == "chunk" then
                meta.upload.next = meta.upload.next + 1
            else
                if status ~= 200 then return retry(meta, now, response, "bad_status") end
                return accept(meta, now, seq, bytes, packet, response)
            end
            meta.attempts, meta.next_at = 0, nil
            save(meta)
            return "progress"
        end
        local code = error_code(response)
        if status == 401 then return pause(meta, "token_rejected", code) end
        if status == 403 then
            if code == "instance_mismatch" or code == "device_mismatch" then return pause(meta, code, code) end
            return pause(meta, "forbidden", code)
        end
        if status == 410 and phase ~= "direct" then
            meta.upload = nil
            return retry(meta, now, response, "upload_expired")
        end
        if status == 413 then
            if phase == "direct" then
                meta.force_upload, meta.attempts, meta.next_at = true, 0, nil
                save(meta)
                return "progress"
            end
            return pause(meta, "too_large", code)
        end
        if status >= 300 and status < 400 then return pause(meta, "redirected", "http_" .. status) end
        if status == 429 or status >= 500 then return retry(meta, now, response, code or ("http_" .. status)) end
        if status == 409 then return pause(meta, "conflict", code) end
        return pause(meta, "rejected", code or ("http_" .. status))
    end

    -- Returns idle, wait, paused, sent, progress or retry.
    function self:step()
        local seq, bytes = store:outbox_head()
        if not seq then return "idle" end
        local now = clock()
        local meta = load()
        if meta.pause and SETTINGS_PAUSES[meta.pause.reason] and meta.pause.tag ~= (opts.tag or json.null) then
            meta = {v = 1, attempts = 0, last_ok = meta.last_ok}
            save(meta)
        end
        if meta.pause then return "paused" end
        if not due(meta, now) then return "wait" end
        -- Decoding is linear in packet size; retries of the same head reuse the result.
        local packet
        if decoded_head and decoded_head.seq == seq and decoded_head.bytes == bytes then packet = decoded_head.packet
        else
            local decoded
            decoded, packet = pcall(codec.decode, bytes)
            if not decoded or type(packet) ~= "table" or packet.seq ~= seq then return pause(meta, "corrupt_packet") end
            decoded_head = {seq = seq, bytes = bytes, packet = packet}
        end
        if #bytes > ENVELOPE then return pause(meta, "too_large", "envelope_limit") end
        if opts.instance_id and packet.instance_id ~= opts.instance_id then return pause(meta, "instance_mismatch") end
        if opts.device_id and packet.device_id ~= opts.device_id then return pause(meta, "device_mismatch") end
        local response, phase = request(meta, seq, bytes, packet)
        return handle(meta, now, seq, bytes, packet, response, phase)
    end
    return self
end
return M
