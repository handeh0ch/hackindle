package.path = "plugin/?.lua;" .. package.path
local capture = require("capture")
local saved, packets = {capture_generation="0"}, {}
local function clone(v)
    if type(v) ~= "table" then return v end
    local result = {}; for k, x in pairs(v) do result[k] = clone(x) end; return result
end
local store = {}
function store:transaction(work)
    local pending, queued = clone(saved), {}
    local tx = {}
    function tx:get(key) return pending[key] end
    function tx:put(key, value) pending[key] = clone(value) end
    function tx:enqueue(seq, value) queued[seq] = value end
    local result = work(tx)
    saved = pending; for k, value in pairs(queued) do packets[k] = value end
    return result
end
local codec = {encode = clone, decode = clone}
local compare = function(a, b) return a - b end
local measure = function(a, b) return b - a end
local function packet(seq, seconds, pieces) return tostring(seq)..":"..seconds..":"..#pieces end
local sample = {source = "source-a", day = "2026-01-01", native_id = "record-1", seconds = 10, first = 0, last = 10, timing = {from = 0, to = 10, quality = "estimated_native_anchor", anchor = "2026-01-01T00:00:00Z"}}
assert(capture.record(store, codec, compare, measure, sample, packet) == "1:10:1")
assert(capture.record(store, codec, compare, measure, sample, packet) == nil)
sample.seconds = 15; sample.timing = {from = 10, to = 15, quality = "estimated_native_anchor", anchor = "2026-01-01T00:00:00Z"}
assert(capture.record(store, codec, compare, measure, sample, packet) == "2:5:0")
sample.seconds = 1
assert(not pcall(function() capture.record(store, codec, compare, measure, sample, packet) end))
assert(packets[1] == "1:10:1" and packets[2] == "2:5:0" and packets[3] == nil)
sample.seconds = nil
assert(capture.record(store, codec, compare, measure, sample, packet) == nil)
print("capture assertions passed")
sample.seconds = 20; sample.timing = {from = 15, to = 20, quality = "estimated_native_anchor", anchor = "2026-01-01T00:00:00Z"}
assert(not pcall(function() capture.record(store, codec, compare, measure, sample, function() error("encoding failed") end) end))
assert(capture.record(store, codec, compare, measure, sample, packet) == "3:5:0")
sample.source = "source-b"; sample.timing.from = 0
assert(capture.record(store, codec, compare, measure, sample, packet) == "4:20:1")
assert(saved.reading.seq == nil and saved.seq == "4")

saved.seq = "bad"
sample.source = "source-c"; sample.timing.from = 0
assert(not pcall(function() capture.record(store, codec, compare, measure, sample, packet) end))
saved.seq = "99999999999999"
assert(capture.record(store, codec, compare, measure, sample, packet) ~= nil)
assert(saved.seq == "100000000000000")
saved.seq = "4"
sample.source = "source-d"
sample.timing = nil
assert(not pcall(function() capture.record(store, codec, compare, measure, sample, packet) end))

sample.source = "source-a"; sample.seconds = 20
sample.first = 20; sample.last = 25; sample.timing = {from = 15, to = 20, quality = "estimated_native_anchor", anchor = "2026-01-01T00:00:00Z"}
assert(not pcall(function() capture.record(store, codec, compare, measure, sample, packet) end))
sample.timing.from = 20
local seen_timing = "unset"
assert(capture.record(store, codec, compare, measure, sample, function(seq, delta, pieces, timing)
    seen_timing = timing
    return "zero-time"
end) == "zero-time")
assert(seen_timing == sample.timing)

sample.source = "source-e"; sample.seconds = nil; sample.observation_id = "observation-1"; sample.first = 0; sample.last = 10
local unavailable = function(seq, seconds, pieces, timing)
    assert(seconds == nil and timing == nil and #pieces == 1)
    return "unavailable-time"
end
assert(capture.record(store, codec, compare, measure, sample, unavailable) == "unavailable-time")
assert(capture.record(store, codec, compare, measure, sample, unavailable) == nil)
sample.source = "source-f"; sample.seconds = 3; sample.native_id = "record-f"; sample.observation_id = "observation-f"
sample.first = nil; sample.last = nil; sample.timing = {from = 0, to = 3, quality = "estimated_native_anchor", anchor = "2026-01-01T00:00:00Z"}
local no_volume = function(seq, seconds, pieces) assert(seconds == 3 and pieces == nil); return "unavailable-volume" end
assert(capture.record(store, codec, compare, measure, sample, no_volume) == "unavailable-volume")
assert(capture.record(store, codec, compare, measure, sample, no_volume) == nil)


saved.capture_generation = "blocked"
assert(not pcall(function() capture.record(store, codec, compare, measure, sample, unavailable) end))
