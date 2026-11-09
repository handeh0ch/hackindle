package.path = "projects/plugin/?.lua;" .. package.path
local identity = require("protocol.identity")
assert(identity.uuid(string.rep("\0",16)) == "00000000-0000-4000-8000-000000000000")
assert(identity.uuid(string.rep("\255",16)) == "ffffffff-ffff-4fff-bfff-ffffffffffff")
assert(not pcall(identity.uuid, "short"))
assert(identity.source(string.rep("a",64)) == string.rep("a",64))
assert(not pcall(identity.source, string.rep("A",64)))
print("identity assertions passed")
