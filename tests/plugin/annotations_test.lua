package.path = "plugin/?.lua;" .. package.path
local annotations = require("annotations")
local state, next_id, captures = {}, 0, 0
local function allocate() next_id = next_id + 1; return "id-"..next_id end
local function extract(record, origin)
    captures = captures + 1
    if record.fail then return {status="pending",reason="unavailable"} end
    return {status="ready",origin=origin,text=record.selection}
end
local input = {key="native-1", selection="range-1", note="note"}
local a = annotations.update(state, "source-a", input, allocate, extract)
assert(a.annotation_id == "id-1" and a.note == "note" and a.context.origin == "creation")
input.note = "edited"
a = annotations.update(state, "source-a", input, allocate, extract)
assert(a.annotation_id == "id-1" and a.note == "edited" and captures == 1)
input.selection = "range-2"; input.fail = true
a = annotations.update(state, "source-a", input, allocate, extract)
assert(a.note == "edited" and a.context.status == "pending")
input.fail = false
a = annotations.update(state, "source-a", input, allocate, extract)
assert(a.context.origin == "backfill")
a = annotations.update(state, "source-b", input, allocate, extract)
assert(a.annotation_id == "id-2")
print("annotation assertions passed")
assert(not pcall(function() annotations.update(state, "source-a", {key="another",selection="x"}, function() return "id-1" end, extract) end))
a = annotations.update(state, "source-a", {key="legacy", selection="r", note="", backfill=true}, allocate, extract)
assert(a.context.origin == "backfill")
local saved, packets = {capture_generation="0"}, {}
local function copy(v) if type(v) ~= "table" then return v end; local o={}; for k,x in pairs(v) do o[k]=copy(x) end; return o end
local store = {}
function store:transaction(work)
    local pending, queued = copy(saved), {}
    local tx = {}
    function tx:get(k) return pending[k] end
    function tx:put(k,v) pending[k]=copy(v) end
    function tx:enqueue(k,v) queued[k]=v end
    local result=work(tx); saved=pending; for k,v in pairs(queued) do packets[k]=v end; return result
end
local codec = {encode=copy, decode=copy}
local function build(seq, version, rows) return seq..":"..version..":"..#rows end
local records = {{key="native-1",selection="range-1",note="note"}}
assert(annotations.snapshot(store, codec, "source-a", records, allocate, extract, build) == "1:1:1")
assert(annotations.snapshot(store, codec, "source-a", nil, allocate, extract, build) == nil)
assert(annotations.snapshot(store, codec, "source-a", {}, allocate, extract, build) == "2:2:0")
assert(not pcall(function() annotations.snapshot(store, codec, "source-a", records, allocate, extract, function() error("failure") end) end))
assert(saved.seq == "2" and packets[3] == nil)
assert(annotations.snapshot(store, codec, "source-a", records, allocate, extract, build) == "3:3:1")
local projected = annotations.update({}, "s", {key="k", selection="r", note="n", kind="highlight", start="start", ["end"]="end", quote="q", chapter="c", native_timestamp="local"}, allocate, extract)
assert(projected.kind == "highlight" and projected.start == "start" and projected["end"] == "end" and projected.quote == "q" and projected.chapter == "c" and projected.native_timestamp == "local")
local marker = {}
local before_count = captures
local bookmark = annotations.update({}, "s", {key="bookmark", kind="bookmark", null=marker}, allocate, extract)
assert(bookmark.context == marker and captures == before_count)

saved.capture_generation = "blocked"
assert(not pcall(function() annotations.snapshot(store, codec, "source-a", records, allocate, extract, build) end))
