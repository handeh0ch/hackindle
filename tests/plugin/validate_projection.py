from lupa.luajit21 import LuaRuntime
import json
import subprocess

lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path = "projects/plugin/?.lua;" .. package.path')
def validate_packet(packet):
    code = '''import {validateEnvelope} from "./contracts/validate.js";
let s=""; for await (const c of process.stdin) s+=c;
process.exit(validateEnvelope(JSON.parse(s)) ? 0 : 1);'''
    return subprocess.run(['node', '--input-type=module', '-e', code], input=packet, text=True).returncode == 0
lua.globals().validate_packet = validate_packet
items = lua.execute(r'''
local envelope, json, segment, context = require("protocol.envelope"), require("protocol.wire_json"), require("reading.segment"), require("snapshots.context")
local id = "48bc0344-efad-4c68-adb6-dc0f0ba57276"
local profile = {instance_id=id,device_id="a92e58b4-851b-467b-a5ad-1eaaccc84c61",reset_generation=0}
local source, instant = ("a"):rep(64), "2026-01-01T00:00:00Z"
local sample = {event_id=id,source_id=source,session_id=id,occurred_at=instant,day="2026-01-01",native_id="native",measurement_version="provisional",provenance="provisional"}
local start, finish = {type="xpointer",value="a"}, {type="xpointer",value="b"}
local pieces = {{first=start,last=finish,characters=3}}
local timing = {quality="estimated_native_anchor",anchor=instant}
local function date_at() return "2026-01-01" end
local projected = {}
for _, seconds in ipairs({0, 5}) do
    local event = segment.build(sample, seconds, pieces, timing, profile, nil, date_at, json.null)
    projected[#projected+1] = envelope.reading(profile, 1, instant, source, {event})
end
local unavailable = segment.build(sample, nil, pieces, nil, profile, nil, date_at, json.null)
projected[#projected+1] = envelope.reading(profile, 1, instant, source, {unavailable})
local c = context.capture(function(n) return n == 1 and "" or "page" end, 2, 1, 1, "rendered", "creation", instant, json.null)
local note = {annotation_id=id,kind="highlight",start=start,["end"]=finish,quote="q",note="n",chapter=json.null,native_timestamp=json.null,context=c}
projected[#projected+1] = envelope.annotations(profile, 2, instant, source, 1, {note})
local pdfstart = {type="pdf",page=2,boxes={{x=1,y=2,width=3,height=4}},geometry_version="provisional"}
local pdfend = {type="pdf",page=2,boxes={{x=2,y=2,width=3,height=4}},geometry_version="provisional"}
local pdfcontext = context.capture(function(n) return "pdf" end, 3, 2, 2, "original_pdf", "backfill", instant, json.null)
local pdfnote = {annotation_id=id,kind="highlight",start=pdfstart,["end"]=pdfend,quote="q",note="n",chapter=json.null,native_timestamp=json.null,context=pdfcontext}
projected[#projected+1] = envelope.annotations(profile, 3, instant, source, 2, {pdfnote})
projected[#projected+1] = envelope.annotations(profile, 3, instant, source, 2, {})
local start_event = {event_id=id,source_id=source,session_id=id,occurred_at=instant,type="session_started",cycle_id=id}
projected[#projected+1] = envelope.reading(profile, 6, instant, source, {start_event})
local ended = {event_id="11111111-1111-4111-8111-111111111111",source_id=source,session_id=id,occurred_at=instant,type="session_ended",cycle_id=id}
local cycle = {event_id="22222222-2222-4222-8222-222222222222",source_id=source,session_id="33333333-3333-4333-8333-333333333333",occurred_at=instant,type="cycle_started",cycle_id="44444444-4444-4444-8444-444444444444"}
local restarted = {event_id="55555555-5555-4555-8555-555555555555",source_id=source,session_id=cycle.session_id,occurred_at=instant,type="session_started",cycle_id=cycle.cycle_id}
projected[#projected+1] = envelope.reading(profile, 7, instant, source, {ended,cycle,restarted})
projected[#projected+1] = envelope.vocabulary(profile, 4, instant, {version=1,words={{word="word",language=json.null,source=json.null}}})
projected[#projected+1] = envelope.legacy(profile, 5, instant, source, {version=1,records={{date="2026-01-01",native_pages=1,native_seconds=1}}})
local source_capture = require("snapshots.source")
local saved = {capture_generation="0"}
local store = {}
function store:transaction(work)
    local pending = {}; for k,v in pairs(saved) do pending[k]=v end
    local tx={}; function tx:get(k) return pending[k] end; function tx:put(k,v) pending[k]=v end
    function tx:enqueue(k,v) end
    local result = work(tx); saved=pending; return result
end
local metadata = {format="epub",title="Synthetic book",authors={"Synthetic author"},language=json.null,identifiers={}}
local progress = {fraction=0.5,position=start,observed_at=instant,session_id=id}
local function build(seq, sections) return envelope.source(profile,seq,instant,source,sections) end
projected[#projected+1] = source_capture.snapshot(store,source,metadata,nil,build)
projected[#projected+1] = source_capture.snapshot(store,source,nil,progress,build)
projected[#projected+1] = source_capture.snapshot(store,source,metadata,progress,build,true)
local app = require("app")
local db={rows={}}
function db:exec(sql,args)
    if sql:match("INSERT OR REPLACE INTO capture_state") then self.rows[args[1]]=args[2] end
end
function db:one(sql,args) return self.rows[args[1]] end
local states, count = {}, 0
local codec = {}
function codec.encode(value) count=count+1; local key=tostring(count); states[key]=value; return key end
function codec.decode(key) return states[key] end
local config={schema_version=1,instance_id=id,reporting_timezone="UTC",characters_per_page=2000,reset_generation=0}
local function u32(n) return string.char(math.floor(n/16777216)%256,math.floor(n/65536)%256,math.floor(n/256)%256,n%256) end
local function header() return "TZif2"..string.rep("\0",15)..u32(0)..u32(0)..u32(0)..u32(0)..u32(1)..u32(4) end
local block=u32(0)..string.char(0,0).."UTC\0"
local bytes=header()..block..header()..block.."\nUTC0\n"
local zoneinfo={root="/synthetic",read_file=function(path,limit) assert(path=="/synthetic/UTC" and limit==1048576); return bytes end}
local instance = app.open(db,codec,config,profile.device_id,function(packet) return validate_packet(packet) end,zoneinfo)
projected[#projected+1] = instance:source_snapshot(source,metadata,progress,instant)
-- Synthetic stand-in for the future authenticated metadata acknowledgement.
db.rows["source_ack:"..source]="epub"
local reading_sample = {source=source,source_id=source,day="2026-01-01",native_id="native",seconds=7,first=0,last=3,
    event_id=id,session_id=id,occurred_at=instant,measurement_version="provisional",provenance="native",
    timing={from=0,to=7,quality="estimated_native_anchor",anchor=instant}}
local adapter={compare=function(a,b) return a-b end,measure=function(a,b) return b-a end,
    locator=function(v) return {type="xpointer",value=tostring(v)} end,date_at=function() return "2026-01-01" end,verify_reporting=function() return true end}
projected[#projected+1] = instance:reading_sample(reading_sample,adapter,instant)
return projected
''')
values = [json.loads(items[i]) for i in range(1, len(items) + 1)]
script = '''import {validateEnvelope} from "./contracts/validate.js";
let s=""; for await (const c of process.stdin) s+=c;
const a=JSON.parse(s); for (const [i,v] of a.entries()) if (!validateEnvelope(v)) throw new Error(`invalid projection ${i}: ${JSON.stringify(v)}`);
'''
subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(values), text=True, check=True)
print(f'{len(values)} synthetic Lua envelopes passed the shared contract validator')
