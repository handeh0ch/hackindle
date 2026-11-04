local identity = require("identity")
local M = {}
-- read() must yield all bytes of one stable file version, then nil; it must
-- return nil plus an error on failure. File stability is an adapter obligation.
-- ffi/sha2 availability on the installed device remains unverified.
function M.stream(read, sha2)
    sha2 = sha2 or require("ffi/sha2")
    local update = sha2.sha256()
    assert(type(update) == "function", "SHA-256 unavailable")
    while true do
        local chunk, err = read()
        if chunk == nil then
            assert(err == nil, "source read failed")
            break
        end
        assert(type(chunk) == "string" and #chunk > 0, "invalid source read")
        update(chunk)
    end
    return identity.source(update())
end
return M
