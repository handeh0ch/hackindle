package.path = "projects/plugin/?.lua;" .. package.path
local sessions = require("reading.sessions")
local saved, packets, ids = {capture_generation="0"}, {}, 0
local function clone(v) if type(v) ~= "table" then return v end; local o={}; for k,x in pairs(v) do o[k]=clone(x) end; return o end
local store={}
function store:transaction(work)
    local pending, queued = clone(saved), {}
    local tx={}; function tx:get(k) return pending[k] end; function tx:put(k,v) pending[k]=clone(v) end
    function tx:enqueue(k,v) queued[k]=v end
    local result=work(tx); saved=pending; for k,v in pairs(queued) do packets[k]=v end; return result
end
local codec={encode=clone,decode=clone}
local function uuid() ids=ids+1; return "uuid-"..ids end
local function build(seq, source, events) return seq..":"..source..":"..events[1].type end
assert(sessions.open(store, codec, "A", "cycle-a", "time-1", uuid, build) == true)
assert(packets[1] == "1:A:session_started")
assert(sessions.open(store, codec, "A", "cycle-a", "time-2", uuid, build) == false)
assert(sessions.open(store, codec, "B", "cycle-b", "time-2", uuid, build) == true)
assert(packets[2] == "2:A:session_ended" and packets[3] == "3:B:session_started")
assert(sessions.close(store, codec, "time-3", uuid, build) == true and packets[4] == "4:B:session_ended")
assert(sessions.close(store, codec, "time-3", uuid, build) == false)
assert(not pcall(function() sessions.open(store, codec, "A", "cycle-a", "time-4", uuid, function() error("failed") end) end))
assert(saved.seq == "4" and saved.lifecycle.active == nil)
print("session assertions passed")
assert(sessions.open(store, codec, "A", "cycle-a", "time-5", uuid, build) == true)
local old_session = saved.lifecycle.active.session
local cycle_events
local function cycle_build(seq, source, events) cycle_events=events; return build(seq, source, events) end
assert(sessions.begin_cycle(store, codec, "time-6", uuid, cycle_build) == true)
assert(packets[6] == "6:A:session_ended")
assert(cycle_events[1].session_id == old_session and cycle_events[1].type == "session_ended")
assert(cycle_events[2].type == "cycle_started" and cycle_events[3].type == "session_started")
assert(cycle_events[2].session_id == cycle_events[3].session_id and cycle_events[3].session_id ~= old_session)
assert(sessions.finish(store, codec, "time-7", uuid, build) == true)
assert(packets[7] == "7:A:book_finished")
assert(sessions.finish(store, codec, "time-8", uuid, build) == false)
assert(sessions.close(store, codec, "time-9", uuid, build) == true)
assert(sessions.open(store, codec, "A", "other-cycle", "time-10", uuid, build) == true)
assert(saved.lifecycle.active.cycle ~= "other-cycle" and saved.lifecycle.active.finished == true)

local existing = saved.seq
assert(not pcall(function() sessions.begin_cycle(store, codec, "time-12", function() return "uuid-2" end, build) end))
assert(saved.seq == existing)
saved.capture_generation = "blocked"
assert(not pcall(function() sessions.close(store, codec, "time-11", uuid, build) end))
