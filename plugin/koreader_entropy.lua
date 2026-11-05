local identity=require("identity")
local M={}

-- Linux getrandom with GRND_NONBLOCK refuses an uninitialized kernel RNG.
-- Symbol availability on the installed device has not been verified.
function M.uuid(ffi)
    local ok,bytes=pcall(function()
        ffi=ffi or require("ffi")
        ffi.cdef[[long getrandom(void *buffer, size_t length, unsigned int flags);]]
        local buffer=ffi.new("uint8_t[16]")
        assert(ffi.C.getrandom(buffer,16,1)==16, "secure random unavailable")
        return ffi.string(buffer,16)
    end)
    if not ok or type(bytes)~="string" or #bytes~=16 then return nil,"secure_random_unavailable" end
    return identity.uuid(bytes)
end
return M
