package.path = "projects/plugin/?.lua;" .. package.path
local json = require("protocol.wire_json")
assert(json.encode({b = json.null, a = json.array({})}) == '{"a":[],"b":null}')
assert(json.encode(json.array({"a\nb", true, 2})) == '["a\\nb",true,2]')
assert(not pcall(function() json.encode("\192\128") end))
local cyclic = {}; cyclic.self = cyclic
assert(not pcall(function() json.encode(cyclic) end))
print("JSON assertions passed")
