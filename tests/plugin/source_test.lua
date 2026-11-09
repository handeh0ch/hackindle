package.path = "projects/plugin/?.lua;" .. package.path
local source = require("snapshots.source")
local saved, packets = {capture_generation="0"}, {}
local store={}
function store:transaction(work)
    local pending, queued = {}, {}; for k,v in pairs(saved) do pending[k]=v end
    local tx={}; function tx:get(k) return pending[k] end; function tx:put(k,v) pending[k]=v end
    function tx:enqueue(k,v) queued[k]=v end
    local result=work(tx); saved=pending; for k,v in pairs(queued) do packets[k]=v end; return result
end
local id, other = ("a"):rep(64), ("b"):rep(64)
local meta={format="epub",title="Synthetic",authors={},identifiers={}}
local progress={fraction=0.5,position={type="xpointer",value="p"},observed_at="2026-01-01T00:00:00Z",session_id="id"}
local function build(seq, sections)
    return seq..":"..(sections.metadata and sections.metadata.version or "-")..":"..(sections.progress and sections.progress.version or "-")
end
assert(source.snapshot(store,id,nil,nil,build) == nil)
assert(source.snapshot(store,id,meta,nil,build) == "1:1:-")
assert(source.snapshot(store,id,nil,progress,build) == "2:-:1")
assert(source.snapshot(store,id,meta,progress,build,true) == "3:2:2")
assert(source.snapshot(store,other,meta,nil,build) == "4:1:-")
assert(not pcall(function() source.snapshot(store,id,meta,progress,function() error("failed") end) end))
assert(saved.seq == "4" and packets[5] == nil)
assert(source.snapshot(store,id,meta,progress,build,true) == "5:3:3")
saved.capture_generation = "blocked"
assert(not pcall(function() source.snapshot(store,id,meta,nil,build) end))
assert(not pcall(function() source.snapshot(store,"invalid",meta,nil,build) end))
print("source assertions passed")
saved.capture_generation = "0"
local unchanged_seq=saved.seq
assert(source.snapshot(store,id,nil,progress,build) == nil)
assert(saved.seq == unchanged_seq)
local boundary_packet=source.snapshot(store,id,nil,progress,build,true)
assert(boundary_packet and saved.seq ~= unchanged_seq)

local before_regression=saved.seq
progress.observed_at="2025-12-31T23:59:00Z"
local ok, message=pcall(function() source.snapshot(store,id,nil,progress,build) end)
assert(not ok and tostring(message):match("clock regressed"))
assert(saved.seq == before_regression and saved["progress_time:"..id] == "2026-01-01T00:00:00Z")
assert(source.snapshot(store,id,nil,progress,build,true))
assert(saved["progress_time:"..id] == "2025-12-31T23:59:00Z")
progress.observed_at="2025-12-31T23:59:59Z"
assert(source.snapshot(store,id,nil,progress,build) == nil)
progress.observed_at="2026-01-01T00:00:00Z"
assert(source.snapshot(store,id,nil,progress,build))
