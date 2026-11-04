package.path = "plugin/?.lua;" .. package.path
local legacy = require("legacy")
local state, queue = {capture_generation="0"}, {}
local store = {}
function store:transaction(work)
    local pending, queued = {}, {}; for k,v in pairs(state) do pending[k]=v end
    local tx={}
    function tx:get(k) return pending[k] end
    function tx:put(k,v) pending[k]=v end
    function tx:enqueue(k,v) queued[k]=v end
    local result=work(tx); state=pending; for k,v in pairs(queued) do queue[k]=v end; return result
end
local a, b = ("a"):rep(64), ("b"):rep(64)
local function build(seq, snapshot) return seq..":"..snapshot.version..":"..#snapshot.records end
assert(legacy.snapshot(store, a, function() return {{date="2026-01-01",native_pages=2,native_seconds=3}} end, build) == "1:1:1")
assert(legacy.snapshot(store, a, function() error("unavailable") end, build) == nil)
assert(legacy.snapshot(store, b, function() return {} end, build) == "2:1:0")
assert(legacy.snapshot(store, a, function() return {} end, build) == "3:2:0")
assert(not pcall(function() legacy.snapshot(store, "not-sha", function() return {} end, build) end))
print("legacy assertions passed")
local s={}
local r = legacy.reconcile(s, {{date="2026-01-01",native_pages=100,native_seconds=100}}, false)
assert(r[1].native_pages == 100 and r[1].native_seconds == 100)
r = legacy.reconcile(s, {{date="2026-01-01",native_pages=100,native_seconds=100}}, true)
assert(r[1].native_pages == 0 and r[1].native_seconds == 0)
r = legacy.reconcile(s, {{date="2026-01-01",native_pages=110,native_seconds=110}}, false)
assert(r[1].native_pages == 10 and r[1].native_seconds == 10)
legacy.reconcile(s, {{date="2026-01-01",native_pages=110,native_seconds=110}}, true)
r = legacy.reconcile(s, {{date="2026-01-01",native_pages=112,native_seconds=112}}, false)
assert(r[1].native_pages == 2 and r[1].native_seconds == 2)

state.capture_generation = "blocked"
assert(not pcall(function() legacy.snapshot(store, a, function() return {} end, build) end))
