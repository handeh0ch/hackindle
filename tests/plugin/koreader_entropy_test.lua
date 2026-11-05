package.path="plugin/?.lua;"..package.path
local entropy=require("koreader_entropy")
local ffi={C={}}
function ffi.cdef() end
function ffi.new() return {} end
function ffi.string(buffer,n) return buffer.bytes end
function ffi.C.getrandom(buffer,n,flags) assert(n==16 and flags==1); buffer.bytes=string.rep("\1",16); return 16 end
assert(entropy.uuid(ffi)=="01010101-0101-4101-8101-010101010101")
function ffi.C.getrandom() return -1 end
local value,reason=entropy.uuid(ffi); assert(value==nil and reason=="secure_random_unavailable")
function ffi.C.getrandom() return 8 end
assert(entropy.uuid(ffi)==nil)
function ffi.C.getrandom() error("missing symbol") end
assert(entropy.uuid(ffi)==nil)
print("KOReader entropy adapter assertions passed")
