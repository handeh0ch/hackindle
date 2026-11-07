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

saved.capture_generation = "0"
assert(capture.establish_epoch(store,codec,"source-z",{verified=true,epoch="epoch-z"}))
assert(not pcall(function() capture.establish_epoch(store,codec,"source-a",{verified=true,epoch="unknown"}) end))
sample.source="source-z"; sample.seconds=1; sample.native_id="z"; sample.first=0; sample.last=1
sample.timing={from=0,to=1,quality="estimated_native_anchor",anchor="2026-01-01T00:00:00Z"}
assert(not pcall(function() capture.record(store,codec,compare,measure,sample,packet) end))
sample.native_epoch="epoch-z"; sample.reset_verified=true
assert(capture.record(store,codec,compare,measure,sample,packet))
-- Page cost must not depend on history: identities are per-key rows plus a chunked index.
for i = 1, 130 do
    local bulk = {source = "source-bulk", day = "2026-01-02", native_id = "record-" .. i, seconds = 1, first = i * 10, last = i * 10 + 5,
        timing = {from = 0, to = 1, quality = "estimated_native_anchor", anchor = "2026-01-02T00:00:00Z"}}
    assert(capture.record(store, codec, compare, measure, bulk, packet))
end
assert(saved["rn_count:source-bulk"] == "130" and saved["rn:source-bulk:record-130"] == "1")
assert(#saved["rn_chunk:source-bulk:0"] == 64 and #saved["rn_chunk:source-bulk:1"] == 64 and #saved["rn_chunk:source-bulk:2"] == 2)
assert(saved["rn_chunk:source-bulk:3"] == nil and saved.reading.native == nil and saved.reading.unavailable == nil)
local again = {source = "source-bulk", day = "2026-01-02", native_id = "record-1", seconds = 3, first = 10, last = 15,
    timing = {from = 1, to = 3, quality = "estimated_native_anchor", anchor = "2026-01-02T00:00:00Z"}}
assert(capture.record(store, codec, compare, measure, again, packet))
assert(saved["rn_count:source-bulk"] == "130" and saved["rn:source-bulk:record-1"] == "3", "a known native id is not indexed twice")
assert(not pcall(function() capture.establish_epoch(store, codec, "source-bulk", {verified = true, epoch = "epoch"}) end))
local unseen = {source = "source-bulk", day = "2026-01-02", observation_id = "obs-1", first = 2000, last = 2005}
local plain = function(seq) return tostring(seq) end
assert(capture.record(store, codec, compare, measure, unseen, plain) and saved["ru:source-bulk:obs-1"] == "1")
assert(capture.record(store, codec, compare, measure, unseen, plain) == nil, "an unavailable observation is credited once")
print("capture per-key state assertions passed")
-- The range ledger keeps only the newest days per source; the credited day is never dropped.
for d = 1, 12 do
    local day = string.format("2026-03-%02d", d)
    local sample = {source = "source-days", day = day, observation_id = "days-" .. d, first = d * 100, last = d * 100 + 50}
    assert(capture.record(store, codec, compare, measure, sample, function(seq) return tostring(seq) end))
end
local kept = 0
for day in pairs(saved.reading.days["source-days"]) do kept = kept + 1 end
assert(kept == 8 and saved.reading.days["source-days"]["2026-03-12"] and saved.reading.days["source-days"]["2026-03-05"] and not saved.reading.days["source-days"]["2026-03-04"])
local old = {source = "source-days", day = "2026-01-01", observation_id = "days-old", first = 1, last = 9}
assert(capture.record(store, codec, compare, measure, old, function(seq) return tostring(seq) end))
assert(saved.reading.days["source-days"]["2026-01-01"], "the day being credited is not pruned in the same turn")
assert(saved.reading.days["source-bulk"] and next(saved.reading.days["source-bulk"]), "other sources are untouched")
print("capture ledger pruning assertions passed")
