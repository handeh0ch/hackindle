local reading = require("reading")
local state = require("state")
local M = {}
-- Native record IDs and cumulative finalized credit are unverified adapter inputs.
-- An unavailable observation needs its own stable identity for replay safety.
function M.record(store, codec, compare, measure, sample, build_packet, guard_packet)
    local unavailable = sample.seconds == nil
    local missing_volume = sample.first == nil and sample.last == nil
    local needs_identity = unavailable or missing_volume
    if needs_identity then
        if type(sample.observation_id) ~= "string" or sample.observation_id == "" then return nil end
    end
    if not unavailable then
        assert(type(sample.native_id) == "string" and sample.native_id ~= "", "native identity unavailable")
        assert(type(sample.seconds) == "number" and sample.seconds >= 0
            and sample.seconds <= 9007199254740991 and sample.seconds == math.floor(sample.seconds), "invalid native credit")
    end
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local serialized = tx:get("reading")
        local data = serialized and codec.decode(serialized) or {days = {}, native = {}, unavailable = {}}
        data.unavailable = data.unavailable or {}
        data.native[sample.source] = data.native[sample.source] or {}
        data.unavailable[sample.source] = data.unavailable[sample.source] or {}
        if needs_identity and data.unavailable[sample.source][sample.observation_id] then return nil end
        local delta
        if not unavailable then
            local previous = data.native[sample.source][sample.native_id] or 0
            assert(sample.seconds >= previous, "native credit regressed; reconciliation required")
            delta = sample.seconds - previous
        end
        local ledger = reading.new(compare, measure, data.days)
        local pieces
        if sample.first ~= nil and sample.last ~= nil then
            pieces = ledger:credit(sample.source, sample.day, sample.first, sample.last)
        else
            assert(sample.first == nil and sample.last == nil, "incomplete visible range")
        end
        if not unavailable and delta == 0 and pieces and #pieces == 0 then return nil end
        if not unavailable then
            local timing = sample.timing
            assert(type(timing) == "table" and timing.from == sample.seconds - delta and timing.to == sample.seconds,
                "delta-specific native chronology unavailable")
            assert((timing.quality == "estimated_native_anchor" and type(timing.anchor) == "string" and timing.anchor ~= "")
                or (timing.quality == "observed_windows" and type(timing.windows) == "table" and #timing.windows > 0),
                "delta-specific native chronology unavailable")
        end
        if sample.event_id ~= nil then state.claim_event(tx, sample.event_id) end
        local seq = state.next_sequence(tx)
        local packet = build_packet(seq, delta, pieces, not unavailable and sample.timing or nil)
        assert(type(packet) == "string", "packet encoding failed")
        if guard_packet then guard_packet(tx, packet) end
        if needs_identity then data.unavailable[sample.source][sample.observation_id] = true end
        if not unavailable then data.native[sample.source][sample.native_id] = sample.seconds end
        tx:put("reading", codec.encode(data))
        tx:enqueue(seq, packet)
        return packet
    end)
end
return M
