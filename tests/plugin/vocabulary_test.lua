package.path = "plugin/?.lua;" .. package.path
local vocabulary = require("vocabulary")
local snapshot = vocabulary.capture(function() return {{word = "hello", language = "en", source = "dictionary"}} end, 3)
assert(snapshot.version == 3 and snapshot.words[1].word == "hello")
assert(vocabulary.capture(function() return {} end, 4).version == 4)
assert(vocabulary.capture(function() return nil end, 5) == nil)
assert(vocabulary.capture(function() error("unavailable") end, 5) == nil)
print("vocabulary assertions passed")
local saved, packets = {capture_generation="0"}, {}
local store = {}
function store:transaction(work)
    local pending, queued = {}, {}; for k,v in pairs(saved) do pending[k]=v end
    local tx={}
    function tx:get(k) return pending[k] end
    function tx:put(k,v) pending[k]=v end
    function tx:enqueue(k,v) queued[k]=v end
    local result=work(tx); saved=pending; for k,v in pairs(queued) do packets[k]=v end; return result
end
local function build(seq, snapshot) return seq..":"..snapshot.version..":"..#snapshot.words end
assert(vocabulary.snapshot(store, function() return {{word="one"}} end, build) == "1:1:1")
assert(vocabulary.snapshot(store, function() return nil end, build) == nil)
assert(vocabulary.snapshot(store, function() return {} end, build) == "2:2:0")
assert(not pcall(function() vocabulary.snapshot(store, function() return {} end, function() error("failed") end) end))
assert(saved.seq == "2" and saved.vocabulary_version == "2" and packets[3] == nil)

saved.capture_generation = "blocked"
assert(not pcall(function() vocabulary.snapshot(store, function() return {} end, build) end))
-- With a codec an unchanged word list is acknowledged without queueing a second full copy.
local wire = require("codec")
saved, packets = {capture_generation="0"}, {}
local words = function() return wire.decode(wire.encode(require("wire_json").array({{word="one"},{word="two"}}))) end
assert(vocabulary.snapshot(store, words, build, wire) == "1:1:2")
assert(vocabulary.snapshot(store, words, build, wire) == true and saved.seq == "1" and packets[2] == nil)
assert(vocabulary.snapshot(store, function() return require("wire_json").array({{word="one"}}) end, build, wire) == "2:2:1")
assert(vocabulary.snapshot(store, words, build, wire) == "3:3:2", "a changed list is queued again, including one seen earlier")
print("vocabulary unchanged-snapshot assertions passed")
