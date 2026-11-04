from lupa.luajit21 import LuaRuntime
import json
import subprocess

lua=LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path="plugin/?.lua;"..package.path')
values=lua.execute(r'''
local bytes=dofile("tests/plugin/tzif_test.lua")
local tz, alloc, json = require("tzif"),require("allocation"),require("wire_json")
local adapter=tz.adapter("America/New_York",function() return bytes end)
local profile={reporting_timezone="America/New_York"}
local inputs={
 {start="2027-03-14T04:59:59Z",["end"]="2027-03-14T05:00:01Z",seconds=3},
 {start="2024-01-02T05:00:00.000000001Z",["end"]="2025-01-01T05:00:00.000000001Z",seconds=367},
 {start="2024-01-01T05:00:00Z",["end"]="2025-01-01T05:00:00Z",seconds=366},
 {start="2024-03-09T05:00:00Z",["end"]="2024-03-11T04:00:00Z",seconds=47},
 {start="2024-11-03T04:00:00Z",["end"]="2024-11-04T05:00:00Z",seconds=25},
 {start="2024-03-10T04:59:59.999999999Z",["end"]="2024-03-10T05:00:00.000000001Z",seconds=1},
 {start="2024-03-10T06:59:59Z",["end"]="2024-03-10T07:00:01Z",seconds=3},
}
local result={}
for _,w in ipairs(inputs) do
 local windows={{start=w.start,["end"]=w["end"]}}
 local allocated=alloc.windows(w.seconds,profile,windows,adapter.split)
 local event={timing_quality="observed_windows",native_seconds=w.seconds,awake_windows=json.array(windows),allocation=json.array(allocated)}
 result[#result+1]=json.encode(event)
end
return result
''')
events=[json.loads(values[i]) for i in range(1,len(values)+1)]
script='''import {validAllocation} from "./server/allocation.js";let s="";for await(const c of process.stdin)s+=c;const a=JSON.parse(s);if(!a.every(e=>validAllocation(e,"America/New_York")))process.exit(1);'''
subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(events),text=True,check=True)
print(f'{len(events)} synthetic TZif allocations match the server allocator')
