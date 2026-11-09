from datetime import datetime, timedelta, timezone
from random import Random
from lupa.luajit21 import LuaRuntime
import json
import subprocess

r=Random(193)
lua=LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path="projects/plugin/?.lua;"..package.path')
lua.execute('local data=dofile("tests/plugin/tzif_test.lua"); zone=require("time.tzif").adapter("America/New_York",function() return data end); alloc=require("time.allocation"); profile={reporting_timezone="America/New_York"}')
g=lua.globals()
events=[]
base=datetime(2027,1,1,tzinfo=timezone.utc)
for _ in range(120):
    start=base+timedelta(seconds=r.randrange(8*365*86400))
    end=start+timedelta(seconds=r.randrange(1,8*86400))
    a=start.strftime('%Y-%m-%dT%H:%M:%S')+f'.{r.randrange(10**9):09d}Z'
    b=end.strftime('%Y-%m-%dT%H:%M:%S')+f'.{r.randrange(10**9):09d}Z'
    windows=lua.table_from([lua.table_from({'start':a,'end':b})])
    seconds=r.randrange(0,100000)
    values=g.alloc.windows(seconds,g.profile,windows,g.zone.split)
    events.append({'timing_quality':'observed_windows','native_seconds':seconds,'awake_windows':[{'start':a,'end':b}],
        'allocation':[{'date':values[i].date,'seconds':values[i].seconds} for i in range(1,len(values)+1)]})
script='''import {validAllocation} from "./projects/server/sync/allocation.js";let s="";for await(const c of process.stdin)s+=c;const a=JSON.parse(s);for(const [i,e] of a.entries())if(!validAllocation(e,"America/New_York"))throw new Error(`case ${i}`);'''
subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(events),text=True,check=True)
print(f'{len(events)} deterministic future TZif allocations match server Intl')
