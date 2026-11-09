package.path = "projects/plugin/?.lua;tests/plugin/?.lua;" .. package.path
local support = require("support")
local state = require("storage.state")
local json = require("protocol.wire_json")
local codec = require("protocol.codec")
local delivery = require("delivery.delivery")

local db = support.memory_db()
local store = state.open(db)
local now = 1000
local clock = function() return now end
local log, applied, obsoleted = {}, {}, {}
local auth = delivery.authenticator()
assert(not auth.verify("x"))
local T = {}
local plan
local function R(status, body, headers) return {status = status, headers = headers or {}, body = body or ""} end
for _, name in ipairs({"post_sync", "create_upload", "put_chunk", "commit"}) do
    T[name] = function(_, ...)
        log[#log + 1] = {name = name, args = {...}}
        return plan(name, ...)
    end
end
local hook_error
local hooks = {
    apply = function(packet, bytes)
        assert(auth.verify(bytes) and not auth.verify(bytes .. "x"))
        if hook_error then error("hook failed", 0) end
        applied[#applied + 1] = packet.seq
    end,
    obsolete = function(generation) obsoleted[#obsoleted + 1] = generation end,
}
local function make(overrides)
    local opts = {store = store, transport = T, clock = clock, auth = auth, hooks = hooks, tag = "t1",
        instance_id = support.instance, device_id = support.device, sha256 = function() return ("0"):rep(64) end,
        limits = {direct_bytes = 1000, chunk_bytes = 2000, envelope_bytes = 5000}}
    for k, v in pairs(overrides or {}) do opts[k] = v end
    return delivery.new(opts)
end
local function enqueue(seq, text) store:transaction(function(tx) tx:enqueue(seq, text) end) end
local function empty() store:transaction(function(tx) for s in pairs(db.outbox) do tx:dequeue(s) end; tx:put("outbox_meta", codec.encode({v = 1, attempts = 0})) end) end
local function ok_ack(text, patch) return R(200, json.encode(support.ack(text, patch))) end

local d = make()
assert(d:step() == "idle" and #log == 0)

-- A matching acknowledgement completes the packet, inside the authentic scope only.
local p1 = support.packet(1)
enqueue(1, p1)
plan = function() return ok_ack(p1) end
assert(d:step() == "sent" and #applied == 1 and applied[1] == 1 and db.outbox[1] == nil and not auth.verify("x"))
local status = d:status()
assert(status.queue == 0 and status.last_ok == 1000 and status.paused == nil)
assert(log[1].name == "post_sync" and log[1].args[1] == p1)

-- A lost acknowledgement resends the identical bytes; backoff follows 5/15/60/300/300 s.
local p2 = support.packet(2)
enqueue(2, p2)
plan = function() return {error = "network"} end
local expected = {5, 15, 60, 300, 300}
for i = 1, 5 do
    assert(d:step() == "retry")
    local next_at = d:status().next_at
    assert(next_at - now == expected[i], "backoff step " .. i)
    assert(d:step() == "wait" and db.outbox[2] == p2)
    now = next_at
end
local before = #log
plan = function() return ok_ack(p2, {status = "duplicate", results = {vocabulary_snapshot = "duplicate"}}) end
assert(d:step() == "sent" and #log == before + 1 and log[#log].args[1] == p2 and db.outbox[2] == nil)

-- Retry-After applies only when larger than the schedule, and is capped.
local p3 = support.packet(3)
enqueue(3, p3)
plan = function() return R(429, "", {["retry-after"] = "120"}) end
assert(d:step() == "retry" and d:status().next_at - now == 120)
now = d:status().next_at
plan = function() return R(503, "", {["retry-after"] = "7"}) end
assert(d:step() == "retry" and d:status().next_at - now == 15)
now = d:status().next_at
plan = function() return R(500, "", {["retry-after"] = "999999"}) end
assert(d:step() == "retry" and d:status().next_at - now == 3600)
-- A clock that moved backwards never waits beyond the schedule.
now = now - 100000
plan = function() return ok_ack(p3) end
assert(d:step() == "sent" and db.outbox[3] == nil)

-- Non-retryable outcomes pause and keep the packet; settings-bound pauses clear when settings change.
local p4 = support.packet(4)
enqueue(4, p4)
plan = function() return R(401, json.encode({schema_version = 1, error = {code = "unauthorized", message = "no"}})) end
assert(d:step() == "paused" and d:status().paused == "token_rejected" and d:status().code == "unauthorized")
local calls = #log
assert(d:step() == "paused" and #log == calls)
local restarted = make()
assert(restarted:step() == "paused" and #log == calls)
plan = function() return ok_ack(p4) end
assert(make({tag = "t2"}):step() == "sent" and db.outbox[4] == nil)

local codes = {
    {403, "instance_mismatch", "instance_mismatch"}, {403, "device_mismatch", "device_mismatch"}, {403, "other", "forbidden"},
    {409, "future_generation", "conflict"}, {400, "bad_request", "rejected"}, {404, nil, "rejected"}, {413, "too_large", "too_large"},
}
for i, case in ipairs(codes) do
    local text = support.packet(10 + i)
    enqueue(10 + i, text)
    local body = case[2] and json.encode({schema_version = 1, error = {code = case[2], message = "m"}}) or "not json"
    plan = function() return R(case[1], body) end
    local subject = make({tag = "t" .. i})
    if case[1] == 413 then
        assert(subject:step() == "progress")   -- direct 413 falls back to the chunk upload
        plan = function(name) if name == "create_upload" then return R(413, body) end end
    end
    assert(subject:step() == "paused" and subject:status().paused == case[3], case[3])
    assert(db.outbox[10 + i] == text)
    subject:resume()
    assert(subject:status().paused == nil)
    empty()
end

-- Invalid acknowledgements are failures: the packet stays and is retried.
local base = support.packet(30, "reading_events")
enqueue(30, base)
local bad = {
    {seq = 31}, {instance_id = support.device}, {device_id = support.instance}, {source_id = ("b"):rep(64)}, {reset_generation = 1},
    {kind = "legacy_statistics"}, {status = "weird"}, {schema_version = 2}, {extra = true}, {current_reset_generation = 2},
    {results = {}}, {results = {["11111111-1111-4111-8111-111111111111"] = "stale"}},
    {results = {["11111111-1111-4111-8111-111111111111"] = "applied", more = "applied"}},
    {results = {["22222222-2222-4222-8222-222222222222"] = "applied"}},
    {results = {["11111111-1111-4111-8111-111111111111"] = "discarded"}},
    {status = "obsolete_discarded", results = {["11111111-1111-4111-8111-111111111111"] = "discarded"}},
    {status = "obsolete_discarded", current_reset_generation = 1, results = {["11111111-1111-4111-8111-111111111111"] = "applied"}},
}
local checker = make({tag = "bad"})
for i, patch in ipairs(bad) do
    plan = function() return ok_ack(base, patch) end
    assert(checker:step() == "retry" and db.outbox[30] == base, "bad ack " .. i)
    now = now + 10000
end
for _, body in ipairs({"{", "[]", "\"x\""}) do
    plan = function() return R(200, body) end
    assert(checker:step() == "retry" and db.outbox[30] == base)
    now = now + 10000
end
plan = function() return R(204, "") end
assert(checker:step() == "retry")
now = now + 10000
-- A stale result is valid for a snapshot section, not for an immutable event.
local snapshot = support.packet(31, "source_snapshot")
empty(); enqueue(31, snapshot)
plan = function() return ok_ack(snapshot, {results = {metadata = "stale"}}) end
assert(make({tag = "s"}):step() == "sent" and db.outbox[31] == nil)

-- An obsolete-generation discard completes the packet without applying it.
empty(); enqueue(40, support.packet(40, "reading_events"))
local reading = db.outbox[40]
plan = function() return ok_ack(reading, {status = "obsolete_discarded", current_reset_generation = 1,
    results = {["11111111-1111-4111-8111-111111111111"] = "discarded"}}) end
local before_applied = #applied
assert(make({tag = "o"}):step() == "sent" and db.outbox[40] == nil and obsoleted[1] == 1 and #applied == before_applied)

-- A failing acknowledgement hook keeps the packet; it pauses after repeated failures.
empty(); local p50 = support.packet(50); enqueue(50, p50)
hook_error = true
plan = function() return ok_ack(p50) end
local hooked = make({tag = "h"})
for i = 1, 4 do
    assert(hooked:step() == "retry" and db.outbox[50] == p50)
    now = hooked:status().next_at
end
assert(hooked:step() == "paused" and hooked:status().paused == "hook_failed")
hook_error = false
hooked:resume()
assert(hooked:step() == "sent" and db.outbox[50] == nil)

-- Chunked upload: create, two chunks, commit; resumable after a restart.
empty()
local large = support.packet(60, "vocabulary_snapshot", {pad = ("x"):rep(2500)})
assert(#large > 2000 and #large < 4000)
enqueue(60, large)
local manifest_text
local uuid = "9d3e0b7c-52b4-4c1e-8f6a-0123456789ab"
plan = function(name, ...)
    if name == "create_upload" then manifest_text = ...; return R(201, json.encode({upload_id = uuid, expires_at = "2026-01-08T00:00:00Z"})) end
    if name == "put_chunk" then return R(204, "") end
    return ok_ack(large)
end
log = {}
local uploader = make({tag = "u"})
assert(uploader:step() == "progress" and uploader:step() == "progress")
local manifest = codec.decode(manifest_text)
assert(manifest.byte_length == #large and manifest.chunk_count == 2 and manifest.sha256 == ("0"):rep(64) and manifest.source_id == json.null and manifest.seq == 60)
assert(log[2].name == "put_chunk" and log[2].args[1] == uuid and log[2].args[2] == 0 and #log[2].args[3] == 2000)
local resumed = make({tag = "u"})
assert(resumed:step() == "progress" and log[3].name == "put_chunk" and log[3].args[2] == 1 and #log[3].args[3] == #large - 2000)
assert(resumed:step() == "sent" and log[4].name == "commit" and log[4].args[1] == uuid and db.outbox[60] == nil)
-- An expired upload (410) is recreated for the same bytes and sequence.
large = support.packet(61, "vocabulary_snapshot", {pad = ("x"):rep(2500)}); enqueue(61, large)
log = {}
plan = function(name) if name == "create_upload" then return R(201, json.encode({upload_id = uuid, expires_at = "x"})) end; return R(410, "") end
local expiring = make({tag = "e"})
assert(expiring:step() == "progress" and expiring:step() == "retry" and d:status().queue == 1)
now = expiring:status().next_at
plan = function(name) if name == "create_upload" then return R(201, json.encode({upload_id = uuid, expires_at = "x"})) end; return R(204, "") end
assert(expiring:step() == "progress" and log[#log].name == "create_upload")
empty()
-- Invalid create responses are retried, never trusted.
large = support.packet(62, "vocabulary_snapshot", {pad = ("x"):rep(2500)}); enqueue(62, large)
for _, response in ipairs({R(200, json.encode({upload_id = uuid})), R(201, "{}"), R(201, json.encode({upload_id = "short"}))}) do
    plan = function() return response end
    local bad_create = make({tag = "c" .. tostring(response)})
    assert(bad_create:step() == "retry" and db.outbox[62] == large)
    now = now + 10000
end
-- A rejected commit status that is not 200 is retried as well.
plan = function(name) if name == "commit" then return R(204, "") end; if name == "create_upload" then return R(201, json.encode({upload_id = uuid, expires_at = "x"})) end; return R(204, "") end
local committer = make({tag = "cm"})
committer:resume()
assert(committer:step() == "progress" and committer:step() == "progress" and committer:step() == "progress" and committer:step() == "retry")
empty()

-- Corrupt or mismatched packets are never sent.
log = {}
enqueue(70, "not json")
assert(make({tag = "k"}):step() == "paused" and make({tag = "k"}):status().paused == "corrupt_packet" and #log == 0)
empty(); enqueue(71, support.packet(72))
assert(make({tag = "k2"}):step() == "paused" and #log == 0)
empty(); enqueue(73, support.packet(73, "vocabulary_snapshot", {pad = ("x"):rep(5200)}))
assert(make({tag = "k3"}):step() == "paused" and make({tag = "k3"}):status().code == "envelope_limit" and #log == 0)
-- A packet for another instance or device is never sent to this server.
empty(); enqueue(74, support.packet(74))
assert(make({tag = "i", instance_id = support.device}):step() == "paused" and #log == 0)
assert(make({tag = "i2", device_id = support.instance}):step() == "paused" and make({tag = "i2"}):status().paused == "device_mismatch" and #log == 0)
-- Without expected identities no pre-send check runs.
plan = function() return ok_ack(db.outbox[74]) end
assert(make({tag = "i3", instance_id = false, device_id = false}):step() == "sent")

-- A head removed during the request cannot be completed by a stale response.
empty(); enqueue(80, support.packet(80))
plan = function() store:transaction(function(tx) tx:dequeue(80) end); return ok_ack(support.packet(80)) end
assert(not pcall(function() make({tag = "z"}):step() end))
-- A corrupt saved delivery state falls back to a clean state.
empty(); enqueue(81, support.packet(81))
store:transaction(function(tx) tx:put("outbox_meta", "garbage") end)
plan = function() return ok_ack(db.outbox[81]) end
assert(make({tag = "y"}):step() == "sent")
local quiet = delivery.new({store = store, transport = T, clock = clock, auth = auth, hooks = {}})
empty(); enqueue(82, support.packet(82))
plan = function() return ok_ack(db.outbox[82]) end
assert(quiet:step() == "sent")
local warned = {}
local noisy = delivery.new({store = store, transport = T, clock = clock, auth = auth, hooks = {apply = function() error("x") end}, warn = function(...) warned[#warned + 1] = {...} end})
empty(); enqueue(83, support.packet(83))
plan = function() return ok_ack(db.outbox[83]) end
assert(noisy:step() == "retry" and #warned == 1)
assert(not pcall(function() delivery.new({}) end))

-- A redirect is never followed or trusted: it pauses the queue.
empty(); enqueue(95, support.packet(95))
plan = function() return R(302, "", {location = "https://elsewhere.example/"}) end
local redirected = make({tag = "r1"})
assert(redirected:step() == "paused" and redirected:status().paused == "redirected" and redirected:status().code == "http_302" and db.outbox[95] ~= nil)
-- A fractional or non-numeric generation is not an acknowledgement.
empty(); local p96 = support.packet(96); enqueue(96, p96)
for _, generation in ipairs({0.5, -1}) do
    plan = function() return ok_ack(p96, {current_reset_generation = generation}) end
    assert(make({tag = "f" .. generation}):step() == "retry" and db.outbox[96] == p96)
    now = now + 10000
end
-- An external hold stops delivery until the settings change or the owner resumes.
empty(); enqueue(90, support.packet(90))
local held = make({tag = "hold1"})
held:hold("server_changed", "server_changed")
local held_calls = #log
assert(held:step() == "paused" and held:status().paused == "server_changed" and held:status().code == "server_changed" and #log == held_calls)
plan = function() return ok_ack(db.outbox[90]) end
assert(make({tag = "hold2"}):step() == "sent")
-- Resuming keeps an open upload: dropping it would orphan the server-side upload
-- (at most two are open per device) and could hold the queue head for days.
empty()
local resumable = support.packet(97, "vocabulary_snapshot", {pad = ("x"):rep(2500)}); enqueue(97, resumable)
plan = function(name)
    if name == "create_upload" then return R(201, json.encode({upload_id = uuid, expires_at = "x"})) end
    if name == "put_chunk" then return R(204, "") end
    return R(409, json.encode({error = {code = "packet_conflict"}}))
end
local keeper = make({tag = "up1"})
assert(keeper:step() == "progress" and keeper:step() == "progress" and keeper:step() == "progress")   -- create, chunks 0 and 1
assert(keeper:step() == "paused" and keeper:status().paused == "conflict")                              -- commit refused
keeper:resume()
log = {}
assert(keeper:step() == "paused" and log[1].name == "commit" and log[1].args[1] == uuid and #log == 1)
-- An upload the server no longer knows (404 upload_not_found) is recreated like an expired one.
empty()
enqueue(98, support.packet(98, "vocabulary_snapshot", {pad = ("x"):rep(2500)}))
plan = function(name)
    if name == "create_upload" then return R(201, json.encode({upload_id = uuid, expires_at = "x"})) end
    return R(404, json.encode({error = {code = "upload_not_found"}}))
end
local forgotten = make({tag = "up2"})
assert(forgotten:step() == "progress" and forgotten:step() == "retry" and forgotten:status().last_error == "upload_expired")
print("delivery assertions passed")
