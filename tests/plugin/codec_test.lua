package.path = "plugin/?.lua;" .. package.path
local codec = require("codec")
local json = require("wire_json")
local data = {name="synthetic", counts={1,2,3}, nested={empty={}, null=json.null}, marker="x\ny"}
local text = codec.encode(data)
local out = codec.decode(text)
assert(out.name == "synthetic" and out.counts[3] == 3 and out.nested.null == json.null and out.marker == "x\ny")
assert(codec.decode('"\\uD83D\\uDE00"') == "😀")
assert(codec.decode('[true,false,null]')[3] == json.null)
assert(not pcall(codec.decode, '{"x":1,"x":2}'))
assert(not pcall(codec.decode, '"\\uD800"'))
assert(not pcall(codec.decode, '[1,]'))
assert(not pcall(codec.decode, '01'))
assert(not pcall(codec.decode, '1e999'))
assert(not pcall(codec.decode, '"\192\128"'))
print("state codec assertions passed")

assert(not pcall(codec.encode, {bad=9007199254740992}))
assert(codec.encode(codec.decode('[]')) == '[]')
assert(not pcall(codec.decode, '{"x":false,"x":true}'))
assert(not pcall(codec.decode, '1.'))
assert(not pcall(codec.decode, '1e+'))
assert(codec.decode('1e2') == 100 and codec.decode('-2.5E-1') == -0.25)
assert(codec.decode('{"x":[] }').x and codec.encode(codec.decode('{"x":[]}')) == '{"x":[]}')
local deep={}; local current=deep
for i=1,129 do current.next={}; current=current.next end
assert(not pcall(codec.encode,deep))
