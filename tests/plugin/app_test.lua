package.path = "plugin/?.lua;" .. package.path
local app = require("app")
local db={rows={},outbox={}}
local function clone(v) if type(v)~="table" then return v end; local o={}; for k,x in pairs(v) do o[k]=clone(x) end; return o end
function db:exec(sql,args)
    if sql == "BEGIN IMMEDIATE" then self.backup={rows=clone(self.rows),outbox=clone(self.outbox)}
    elseif sql == "ROLLBACK" then self.rows=self.backup.rows; self.outbox=self.backup.outbox
    elseif sql:match("INSERT OR REPLACE INTO capture_state") then self.rows[args[1]]=args[2]
    elseif sql:match("INSERT INTO outbox") then assert(not self.outbox[args[1]]); self.outbox[args[1]]=args[2] end
end
function db:one(sql,args) return self.rows[args[1]] end
local objects,n={},0
local codec={}
function codec.encode(value) n=n+1; local key="encoded-"..n; objects[key]=clone(value); return key end
function codec.decode(value) return clone(assert(objects[value])) end
local config={schema_version=1,instance_id="48bc0344-efad-4c68-adb6-dc0f0ba57276",reporting_timezone="UTC",characters_per_page=2000,reset_generation=0,unicode_version=require("unicode_lower").version}
local device="a92e58b4-851b-467b-a5ad-1eaaccc84c61"
local function u32(n) return string.char(math.floor(n/16777216)%256,math.floor(n/65536)%256,math.floor(n/256)%256,n%256) end
local function header() return "TZif2"..string.rep("\0",15)..u32(0)..u32(0)..u32(0)..u32(0)..u32(1)..u32(4) end
local block=u32(0)..string.char(0,0).."UTC\0"
local utc_bytes=header()..block..header()..block.."\nUTC0\n"
local provider={root="/synthetic",read_file=function(path,limit) assert(path=="/synthetic/UTC" and limit==1048576); return utc_bytes end}
local valid=function() return true end
local verified_ack_bytes
local function authenticated(bytes) return bytes==verified_ack_bytes end
local a=app.open(db,codec,config,device,valid,provider)
local metadata={format="epub",title="Synthetic",authors={},language=require("wire_json").null,identifiers={}}
local id=("a"):rep(64)
assert(a:source_snapshot(id,metadata,nil,"2026-01-01T00:00:00Z"))
local b=app.open(db,codec,config,device,valid,provider)
assert(b:source_snapshot(id,metadata,nil,"2026-01-01T00:00:01Z"))
assert(not pcall(function() b:source_snapshot(id,nil,{fraction=0.4,position={type="xpointer",value="x"},observed_at="2026-01-01T00:00:02Z",session_id=config.instance_id},"2026-01-01T00:00:02Z") end))
assert(db.outbox[1]:match('"version":1') and db.outbox[2]:match('"version":2'))
local wrong=clone(config); wrong.instance_id="wrong"
assert(not pcall(function() app.open(db,codec,wrong,device,valid,provider) end))
assert(not pcall(function() app.open(db,codec,config,"different-device",valid,provider) end))
local reset=clone(config); reset.reset_generation=1
local paused=app.open(db,codec,reset,device,valid,provider,authenticated)
assert(not pcall(function() paused:source_snapshot(id,metadata,nil,"2026-01-01T00:00:02Z") end))
assert(not pcall(function() a:source_snapshot(id,metadata,nil,"2026-01-01T00:00:02Z") end))
assert(db.outbox[3] == nil)
local reset_meta=paused:reset_source_metadata(id,metadata,"2026-01-01T00:00:02Z")
assert(reset_meta and reset_meta.seq==3)
local reset_ack={schema_version=1,instance_id=config.instance_id,device_id=device,source_id=id,reset_generation=1,current_reset_generation=1,seq=3,kind="source_snapshot",status="applied",results={metadata="applied"}}
local reset_ack_bytes=require("codec").encode(reset_ack)
assert(not paused:reset_source_metadata_ack(reset_ack_bytes))
verified_ack_bytes=reset_ack_bytes
assert(paused:reset_source_metadata_ack(reset_ack_bytes))
assert(paused:reset_source_metadata_ack(reset_ack_bytes))   -- replay after a crash
assert(paused:begin_legacy_baseline(id))
local annotation_ticket=paused:begin_annotation_reset(id)
local ann={key="native",selection="selection",kind="highlight",start={type="xpointer",value="a"},["end"]={type="xpointer",value="b"},quote="synthetic",note="",chapter=require("wire_json").null,native_timestamp=require("wire_json").null}
assert(paused:annotation_reset_baseline(id,annotation_ticket,{ann}))
local read_ticket=paused:begin_annotation_read(id)
assert(paused:annotation_reset_snapshot(id,read_ticket,{ann},function() return config.instance_id end,function() return {status="pending",reason="unavailable"} end,"2026-01-01T00:00:03Z"))
local reading_ticket=paused:begin_reading_reset(id)
assert(paused:reading_reset_baseline(id,reading_ticket,{verified=true,epoch=config.instance_id,native={},ranges={}},function(a,b) return a-b end))
local reset_progress={fraction=0.5,position={type="xpointer",value="x"},observed_at="2026-01-01T00:00:04Z",session_id=config.instance_id}
assert(not pcall(function() paused:source_snapshot(id,nil,reset_progress,"2026-01-01T00:00:04Z",true) end))
assert(paused:source_snapshot(id,nil,reset_progress,"2026-01-01T00:00:04Z",true,true))
local after_reset_sample={source=id,source_id=id,day="2026-01-01",native_id="native-new",seconds=2,first=0,last=1,
    native_epoch=config.instance_id,reset_verified=true,event_id=config.instance_id,session_id=config.instance_id,
    occurred_at="2026-01-01T00:00:04Z",measurement_version="v1",provenance="native",
    timing={from=0,to=2,quality="estimated_native_anchor",anchor="2026-01-01T00:00:04Z"}}
local reading_adapter={compare=function(a,b) return a-b end,measure=function(a,b) return b-a end,locator=function(n) return {type="xpointer",value=tostring(n)} end}
assert(paused:reading_sample(after_reset_sample,reading_adapter,"2026-01-01T00:00:04Z"))
local reset_uuid_counter=0
local function reset_uuid() reset_uuid_counter=reset_uuid_counter+1; return string.format("10000000-0000-4000-8000-%012d",reset_uuid_counter) end
assert(not pcall(function() paused:session_open(id,reset_uuid(),"2026-01-01T00:00:05Z",reset_uuid) end))
assert(paused:session_open(id,reset_uuid(),"2026-01-01T00:00:05Z",reset_uuid,true))
assert(paused:session_close("2026-01-01T00:00:06Z",reset_uuid,true))
local vocab_ticket=paused:begin_vocabulary_reset()
local vocab_base=paused:vocabulary_reset_baseline(vocab_ticket,{},"2026-01-01T00:00:05Z")
assert(vocab_base and vocab_base.packet)
print("application factory assertions passed")


local preexisting={rows={seq="1"},outbox={}}
setmetatable(preexisting,{__index=db})
assert(not pcall(function() app.open(preexisting,codec,config,device,valid,provider) end))
local builtin_db={rows={},outbox={}}
setmetatable(builtin_db,{__index=db})
local first=app.open(builtin_db,nil,config,device,valid,provider,authenticated)
assert(first:source_snapshot(id,metadata,nil,"2026-01-01T00:00:00Z"))
assert(not first:source_metadata_ready(id))
assert(not pcall(function() first:source_snapshot(id,nil,{fraction=0.4,position={type="xpointer",value="x"},observed_at="2026-01-01T00:00:01Z",session_id=config.instance_id},"2026-01-01T00:00:01Z") end))
local initial_ack={schema_version=1,instance_id=config.instance_id,device_id=device,source_id=id,reset_generation=0,current_reset_generation=0,seq=1,kind="source_snapshot",status="applied",results={metadata="applied"}}
local initial_ack_bytes=require("codec").encode(initial_ack)
assert(not first:source_metadata_ack(initial_ack_bytes))
verified_ack_bytes=initial_ack_bytes
assert(first:source_metadata_ack(initial_ack_bytes))
-- A crash between the hook and the queue delete replays the acknowledgement: it must be idempotent.
assert(first:source_metadata_ack(initial_ack_bytes) and first:source_metadata_ready(id))
assert(first:source_metadata_ready(id))
local pdf_position={type="pdf",page=1,boxes={{x=1,y=2,width=3,height=4}},geometry_version="provisional"}
assert(not pcall(function() first:source_snapshot(id,nil,{fraction=0.4,position=pdf_position,observed_at="2026-01-01T00:00:01Z",session_id=config.instance_id},"2026-01-01T00:00:01Z") end))
local wrong_metadata=clone(metadata); wrong_metadata.format="pdf"
assert(not pcall(function() first:source_snapshot(id,wrong_metadata,nil,"2026-01-01T00:00:01Z") end))
assert(builtin_db.rows.seq=="1" and builtin_db.outbox[2]==nil)
local restarted=app.open(builtin_db,nil,config,device,valid,provider)
assert(restarted:source_snapshot(id,nil,{fraction=0.4,position={type="xpointer",value="x"},observed_at="2026-01-01T00:00:01Z",session_id=config.instance_id},"2026-01-01T00:00:01Z"))
assert(builtin_db.outbox[2]:match('"progress"') and builtin_db.rows.seq == "2")
local s={source=id,source_id=id,day="2026-01-01",native_id="native",seconds=7,first=0,last=3,
    event_id=config.instance_id,session_id=config.instance_id,occurred_at="2026-01-01T00:00:03Z",measurement_version="v1",provenance="native",
    timing={from=0,to=7,quality="estimated_native_anchor",anchor="2026-01-01T00:00:03Z"}}
local adapter={compare=function(x,y) return x-y end,measure=function(x,y) return y-x end,
    locator=function(x) return {type="xpointer",value=tostring(x)} end,date_at=function() return "2026-01-01" end,verify_reporting=function() return true end}
local mismatch=clone(adapter); mismatch.locator=function() return pdf_position end
assert(not pcall(function() restarted:reading_sample(s,mismatch,"2026-01-01T00:00:03Z") end))
assert(builtin_db.rows.seq=="2" and builtin_db.outbox[3]==nil)
assert(restarted:reading_sample(s,adapter,"2026-01-01T00:00:03Z"))
assert(builtin_db.outbox[3]:match('"reading_segment"') and builtin_db.outbox[3]:match('"credited_characters":3'))
assert(restarted:reading_sample(s,adapter,"2026-01-01T00:00:03Z") == nil)
local third=app.open(builtin_db,nil,config,device,valid,provider)
assert(third:reading_sample(s,adapter,"2026-01-01T00:00:03Z") == nil)
s.seconds=10; s.timing={from=7,to=10,quality="estimated_native_anchor",anchor="2026-01-01T00:00:04Z"}
assert(not pcall(function() third:reading_sample(s,adapter,"2026-01-01T00:00:04Z") end))
assert(builtin_db.rows.seq == "3" and builtin_db.outbox[4] == nil)
s.event_id="11111111-1111-4111-8111-111111111111"
assert(third:reading_sample(s,adapter,"2026-01-01T00:00:04Z"))
assert(builtin_db.outbox[4]:match('"native_seconds":3') and builtin_db.outbox[4]:match('"credited_characters":0'))
local after_reset=clone(config); after_reset.reset_generation=1
app.open(builtin_db,nil,after_reset,device,valid,provider)
assert(not pcall(function() third:reading_sample(s,adapter,"2026-01-01T00:00:04Z") end))
assert(builtin_db.outbox[5] == nil)
local bad_validator=function() return false end
local validated_db={rows={},outbox={}}
setmetatable(validated_db,{__index=db})
local vapp=app.open(validated_db,nil,config,device,bad_validator,provider)
assert(not pcall(function() vapp:source_snapshot(id,metadata,nil,"bad-time") end))
assert(validated_db.rows.seq == nil and validated_db.outbox[1] == nil)

local ordinary_db={rows={},outbox={}}; setmetatable(ordinary_db,{__index=db})
local ordinary=app.open(ordinary_db,nil,config,device,valid,provider,authenticated)
assert(ordinary:source_snapshot(id,metadata,nil,"2026-01-01T00:00:00Z"))
local ordinary_ack=require("codec").encode({schema_version=1,instance_id=config.instance_id,device_id=device,source_id=id,reset_generation=0,current_reset_generation=0,seq=1,kind="source_snapshot",status="applied",results={metadata="applied"}})
verified_ack_bytes=ordinary_ack; assert(ordinary:source_metadata_ack(ordinary_ack))
local record={key="note",selection="r",kind="highlight",start={type="xpointer",value="a"},["end"]={type="xpointer",value="b"},quote="x",note="",chapter=require("wire_json").null,native_timestamp=require("wire_json").null}
assert(ordinary:annotations_snapshot(id,{record},function() return config.instance_id end,function() return {status="pending",reason="unavailable"} end,"2026-01-01T00:00:01Z"))
assert(ordinary:vocabulary_snapshot(function() return {{word="word",language=require("wire_json").null,source=require("wire_json").null}} end,"2026-01-01T00:00:02Z"))
assert(ordinary:legacy_initial(id,function() return {{date="2026-01-01",native_pages=1,native_seconds=2}} end,"2026-01-01T00:00:03Z"))
local native_connection={prepare=function(_,sql)
    local done=false
    return {bind1=function() end,step=function() if done then return nil end; done=true; return {1,1767225600,3,100} end,close=function() end}
end}
local native_binding={verified=true,readonly=true,source_id=id,native_book_id=1}
assert(ordinary:legacy_native_initial(id,native_connection,native_binding,"2026-01-01T00:00:03Z"))
assert(not pcall(function() ordinary:legacy_native_initial(("b"):rep(64),native_connection,native_binding,"2026-01-01T00:00:03Z") end))
local next_uuid=0
local function uuid() next_uuid=next_uuid+1; return string.format("00000000-0000-4000-8000-%012d",next_uuid) end
assert(ordinary:session_open(id,uuid(),"2026-01-01T00:00:04Z",uuid))
assert(ordinary:finish_book("2026-01-01T00:00:05Z",uuid))
assert(ordinary:begin_cycle("2026-01-01T00:00:06Z",uuid))
assert(ordinary:session_close("2026-01-01T00:00:07Z",uuid))


local cadence_db={rows={},outbox={}}; setmetatable(cadence_db,{__index=db})
local c1=app.open(cadence_db,nil,config,device,valid,provider)
local p={fraction=0.1,position={type="xpointer",value="x"},observed_at="2026-01-01T00:00:00Z",session_id=config.instance_id}
assert(c1:source_snapshot(id,metadata,p,"2026-01-01T00:00:00Z"))
cadence_db.rows["source_ack:"..id]="epub"
local c2=app.open(cadence_db,nil,config,device,valid,provider)
p.observed_at="2026-01-01T00:00:59Z"
assert(c2:source_snapshot(id,nil,p,"2026-01-01T00:00:59Z") == nil)
assert(c2:source_snapshot(id,nil,p,"2026-01-01T00:00:59Z",true))
assert(cadence_db.rows.seq == "2")
local allocation_db={rows={},outbox={}}; setmetatable(allocation_db,{__index=db})
local unverified=app.open(allocation_db,nil,config,device,valid,provider)
assert(unverified:source_snapshot(id,metadata,nil,"2026-01-01T00:00:00Z"))
allocation_db.rows["source_ack:"..id]="epub"
local original_id=s.event_id
s.event_id="22222222-2222-4222-8222-222222222222"; s.seconds=7
s.timing={from=0,to=7,quality="estimated_native_anchor",anchor="2026-01-01T00:00:03Z"}
local no_verifier=clone(adapter); no_verifier.verify_reporting=nil
assert(unverified:reading_sample(s,no_verifier,"2026-01-01T00:00:03Z"))
assert(allocation_db.rows.seq == "2" and allocation_db.outbox[2])
s.event_id=original_id

local wrong_zone_db={rows={},outbox={}}; setmetatable(wrong_zone_db,{__index=db})
local wrong_zone=app.open(wrong_zone_db,nil,config,device,valid,provider)
assert(wrong_zone:source_snapshot(id,metadata,nil,"2026-01-01T00:00:00Z"))
wrong_zone_db.rows["source_ack:"..id]="epub"
local wrong_adapter=clone(adapter); wrong_adapter.verify_reporting=function() return false end
assert(wrong_zone:reading_sample(s,wrong_adapter,"2026-01-01T00:00:03Z"))
assert(wrong_zone_db.rows.seq == "2" and wrong_zone_db.outbox[2])

-- The factory must supply its own validator and bind TZif to the profile.
local integrated_db={rows={},outbox={}}; setmetatable(integrated_db,{__index=db})
local integrated=app.open(integrated_db,nil,config,device,nil,provider)
assert(not pcall(function() integrated:source_snapshot(id,metadata,nil,"bad-time") end))
assert(integrated_db.rows.seq==nil and integrated_db.outbox[1]==nil)
assert(integrated:source_snapshot(id,metadata,nil,"2026-01-01T00:00:00Z"))
integrated_db.rows["source_ack:"..id]="epub"
local tampered=clone(adapter); tampered.date_at=function() return "1900-01-01" end
tampered.verify_reporting=function() return true end
s.event_id="33333333-3333-4333-8333-333333333333"
assert(integrated:reading_sample(s,tampered,"2026-01-01T00:00:03Z"))
assert(integrated_db.outbox[2]:match('"date":"2026%-01%-01"'))
s.event_id="44444444-4444-4444-8444-444444444444"; s.seconds=9
s.timing={from=7,to=9,quality="estimated_native_anchor",anchor="2026-01-01T00:00:05Z"}
assert(not pcall(function() integrated:reading_sample(s,tampered,"not-a-timestamp") end))
assert(integrated_db.rows.seq=="2" and integrated_db.outbox[3]==nil)
assert(integrated:reading_sample(s,tampered,"2026-01-01T00:00:05Z"))
assert(integrated_db.outbox[3]:match('"native_seconds":2'))
local bad_db={rows={},outbox={}}; setmetatable(bad_db,{__index=db})
assert(not pcall(function() app.open(bad_db,nil,config,device,nil,{root="/synthetic",read_file=function() return "bad" end}) end))
assert(bad_db.rows.seq==nil and next(bad_db.outbox)==nil)
assert(not pcall(function() app.open(bad_db,nil,config,device) end))
assert(bad_db.rows.seq==nil and next(bad_db.outbox)==nil)
local barrier_db={rows={},outbox={}}; setmetatable(barrier_db,{__index=db})
local old_handle=app.open(barrier_db,nil,config,device,nil,provider)
local new_generation=clone(config); new_generation.reset_generation=1
assert(not pcall(function() app.open(barrier_db,nil,new_generation,device,nil,{root="/synthetic",read_file=function() return "bad" end}) end))
assert(not pcall(function() old_handle:source_snapshot(id,metadata,nil,"2026-01-01T00:00:00Z") end))
assert(barrier_db.rows.seq==nil and next(barrier_db.outbox)==nil)
