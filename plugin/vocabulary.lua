local state = require("state")
local M = {}
-- Only a successful, complete native read can replace the previous snapshot.
function M.capture(read, version)
    local ok, words = pcall(read)
    if not ok or type(words) ~= "table" then return nil end
    return {version = version, words = words}
end
function M.snapshot(store, read, build_packet)
    local ok, words = pcall(read)
    if not ok or type(words) ~= "table" then return nil end
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local version = state.next_counter(tx, "vocabulary_version")
        local seq = state.next_sequence(tx)
        local packet = build_packet(seq, {version = version, words = words})
        assert(type(packet) == "string", "packet encoding failed")
        tx:enqueue(seq, packet)
        return packet
    end)
end
return M
