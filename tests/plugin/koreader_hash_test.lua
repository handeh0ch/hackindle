package.path = "plugin/?.lua;" .. package.path
local hash = require("koreader_hash")
local fed={}
local digest=("a"):rep(64)
local sha={sha256=function() return function(part)
    if part == nil then return digest end
    fed[#fed+1]=part
end end}
local chunks={"abc","def"}; local i=0
assert(hash.stream(function() i=i+1; return chunks[i] end,sha) == digest)
assert(table.concat(fed)=="abcdef")
assert(not pcall(function() hash.stream(function() return nil,"read error" end,sha) end))
assert(not pcall(function() hash.stream(function() return "" end,sha) end))
assert(not pcall(function() hash.stream(function() return nil end,{sha256=function() return function() return "bad" end end}) end))
print("KOReader hashing adapter assertions passed")
