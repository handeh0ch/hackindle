local state_store = require("state")
local M = {}
-- Native keys and selection fingerprints are provisional adapter inputs.
function M.update(state, source, record, allocate, extract)
    state.sources = state.sources or {}
    state.owners = state.owners or {}
    state.sources[source] = state.sources[source] or {}
    local prior = state.sources[source][record.key]
    local id = prior and prior.annotation_id or allocate()
    assert(type(id) == "string" and id ~= "", "annotation ID unavailable")
    local owner = state.owners[id]
    assert(not owner or (owner.source == source and owner.key == record.key), "annotation ID collision")
    local changed = not prior or prior.selection ~= record.selection or prior.kind ~= record.kind
    local value = prior and prior.context
    if record.kind == "bookmark" then
        assert(record.null ~= nil, "JSON null sentinel required")
        value = record.null
    elseif changed or (value and value.status == "pending") then
        local origin = changed and not record.backfill and "creation" or "backfill"
        local ok, result = pcall(extract, record, origin)
        value = ok and result or nil
        if type(value) ~= "table" then value = {status = "pending", reason = "context extraction unavailable"} end
    end
    local saved = {annotation_id = id, selection = record.selection, kind = record.kind, context = value}
    state.sources[source][record.key] = saved
    state.owners[id] = {source = source, key = record.key}
    return {annotation_id = id, kind = record.kind, start = record.start, ["end"] = record["end"],
        quote = record.quote, note = record.note, chapter = record.chapter,
        native_timestamp = record.native_timestamp, context = value}
end
-- records must be a successfully read complete set, not an unavailable source.
function M.snapshot(store, codec, source, records, allocate, extract, build_packet)
    if records == nil then return nil end
    return store:transaction(function(tx)
        state_store.assert_capture_enabled(tx)
        local encoded = tx:get("annotations")
        local data = encoded and codec.decode(encoded) or {}
        data.versions = data.versions or {}
        local rows, seen = {}, {}
        for _, record in ipairs(records) do
            assert(type(record.key) == "string" and record.key ~= "" and not seen[record.key], "invalid native annotation identity")
            seen[record.key] = true
            rows[#rows + 1] = M.update(data, source, record, allocate, extract)
        end
        local version = (data.versions[source] or 0) + 1
        assert(version <= 9007199254740991, "annotation version exhausted")
        local seq = state_store.next_sequence(tx)
        local packet = build_packet(seq, version, rows)
        assert(type(packet) == "string", "packet encoding failed")
        data.versions[source] = version
        tx:put("annotations", codec.encode(data))
        tx:enqueue(seq, packet)
        return packet
    end)
end
return M
