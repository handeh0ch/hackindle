local state = require("storage.state")
local M = {}
-- Only a successful, complete native read can replace the previous snapshot.
function M.capture(read, version)
    local ok, words = pcall(read)
    if not ok or type(words) ~= "table" then return nil end
    return {version = version, words = words}
end
-- With a codec, an unchanged word list is not queued again: every suspend and
-- close would otherwise add a full copy of the vocabulary to the outbox.
function M.snapshot(store, read, build_packet, codec)
    local ok, words = pcall(read)
    if not ok or type(words) ~= "table" then return nil end
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local encoded = codec and codec.encode(words)
        if encoded ~= nil and tx:get("vocabulary_last") == encoded then return true end
        local version = state.next_counter(tx, "vocabulary_version")
        local seq = state.next_sequence(tx)
        local packet = build_packet(seq, {version = version, words = words})
        assert(type(packet) == "string", "packet encoding failed")
        if encoded ~= nil then tx:put("vocabulary_last", encoded) end
        tx:enqueue(seq, packet)
        return packet
    end)
end
return M
