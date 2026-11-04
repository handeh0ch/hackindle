local state = require("state")
local M = {}
local function event(kind, active, at, uuid)
    return {type = kind, event_id = uuid(), source_id = active.source, session_id = active.session,
        cycle_id = active.cycle, occurred_at = at}
end
local function queue(tx, source, events, build_packet)
    for _, item in ipairs(events) do state.claim_event(tx, item.event_id) end
    local seq = state.next_sequence(tx)
    local packet = build_packet(seq, source, events)
    assert(type(packet) == "string", "packet encoding failed")
    tx:enqueue(seq, packet)
end
function M.open(store, codec, source, cycle, at, uuid, build_packet)
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local encoded = tx:get("lifecycle")
        local data = encoded and codec.decode(encoded) or {}
        if data.active and data.active.source == source then return false end
        if data.active then
            queue(tx, data.active.source, {event("session_ended", data.active, at, uuid)}, build_packet)
        end
        data.cycles = data.cycles or {}
        local current = data.cycles[source]
        local first = not current
        if first then current = {id = cycle, finished = false}; data.cycles[source] = current end
        data.active = {source = source, cycle = current.id, finished = current.finished, session = uuid()}
        local events = {event("session_started", data.active, at, uuid)}
        if first then events[#events + 1] = event("cycle_started", data.active, at, uuid) end
        queue(tx, source, events, build_packet)
        tx:put("lifecycle", codec.encode(data))
        return true
    end)
end
function M.close(store, codec, at, uuid, build_packet)
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local encoded = tx:get("lifecycle")
        local data = encoded and codec.decode(encoded) or {}
        if not data.active then return false end
        queue(tx, data.active.source, {event("session_ended", data.active, at, uuid)}, build_packet)
        data.active = nil
        tx:put("lifecycle", codec.encode(data))
        return true
    end)
end
function M.begin_cycle(store, codec, at, uuid, build_packet)
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local encoded = tx:get("lifecycle")
        local data = encoded and codec.decode(encoded) or {}
        if not data.active then return false end
        local ended = event("session_ended", data.active, at, uuid)
        data.active.cycle = uuid()
        data.active.session = uuid()
        data.active.finished = false
        data.cycles[data.active.source] = {id = data.active.cycle, finished = false}
        local events = {ended, event("cycle_started", data.active, at, uuid), event("session_started", data.active, at, uuid)}
        queue(tx, data.active.source, events, build_packet)
        tx:put("lifecycle", codec.encode(data))
        return true
    end)
end
function M.finish(store, codec, at, uuid, build_packet)
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local encoded = tx:get("lifecycle")
        local data = encoded and codec.decode(encoded) or {}
        if not data.active or data.active.finished then return false end
        data.active.finished = true
        data.cycles[data.active.source].finished = true
        queue(tx, data.active.source, {event("book_finished", data.active, at, uuid)}, build_packet)
        tx:put("lifecycle", codec.encode(data))
        return true
    end)
end
return M
