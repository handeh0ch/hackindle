package.path="plugin/?.lua;"..package.path
package.preload["ui/widget/container/widgetcontainer"]=function()
    return {extend=function(_,spec) spec.__index=spec; return spec end}
end
local Entry=dofile("plugin/main.lua")
local app_factory=require("app")
local wire=require("codec")
local json=require("wire_json")
local id="48bc0344-efad-4c68-adb6-dc0f0ba57276"
local device="a92e58b4-851b-467b-a5ad-1eaaccc84c61"
local source=("a"):rep(64)
local db={rows={},outbox={}}
local function copy(value) if type(value)~="table" then return value end; local out={}; for k,v in pairs(value) do out[k]=copy(v) end; return out end
function db:exec(sql,args)
    if sql=="BEGIN IMMEDIATE" then self.backup={rows=copy(self.rows),outbox=copy(self.outbox)}
    elseif sql=="ROLLBACK" then self.rows=self.backup.rows; self.outbox=self.backup.outbox
    elseif sql:match("INSERT OR REPLACE INTO capture_state") then self.rows[args[1]]=args[2]
    elseif sql:match("INSERT INTO outbox") then assert(not self.outbox[args[1]]); self.outbox[args[1]]=args[2] end
end
function db:one(sql,args) return self.rows[args[1]] end
local function u32(n) return string.char(math.floor(n/16777216)%256,math.floor(n/65536)%256,math.floor(n/256)%256,n%256) end
local function header() return "TZif2"..string.rep("\0",15)..u32(0)..u32(0)..u32(0)..u32(0)..u32(1)..u32(4) end
local block=u32(0)..string.char(0,0).."UTC\0"
local zone=header()..block..header()..block.."\nUTC0\n"
local ack_bytes
local config={schema_version=1,instance_id=id,reporting_timezone="UTC",characters_per_page=2000,reset_generation=0,unicode_version=require("unicode_lower").version}
local app=app_factory.open(db,nil,config,device,nil,{root="/synthetic",read_file=function() return zone end},function(bytes) return bytes==ack_bytes end)
local adapter={}
local source_adapter=require("koreader_metadata").new(function(path)
    assert(path=="/synthetic/book.epub"); return {verified=true,source_id=source,format="epub"}
end,function() return "2026-01-01T00:00:00Z" end)
function adapter:source(ui) return source_adapter:source(ui) end
function adapter:begin_page(ui,page) return {page=page,verified=true,durable=true} end
function adapter:discard_page(ui,token) return true end
function adapter:finish_page(ui,token,next_page)
    return {verified=true,captured_at="2026-01-01T00:00:03Z",adapter={compare=function(a,b) return a-b end,measure=function(a,b) return b-a end,locator=function(n) return {type="xpointer",value=tostring(n)} end},
        sample={source=source,source_id=source,day="2026-01-01",native_id="synthetic-native",seconds=2,first=0,last=2,event_id=id,session_id=id,occurred_at="2026-01-01T00:00:03Z",measurement_version="synthetic",provenance="synthetic",timing={from=0,to=2,quality="estimated_native_anchor",anchor="2026-01-01T00:00:03Z"}}}
end
function adapter:annotations()
    return {verified=true,complete=true,source_id=source,captured_at="2026-01-01T00:00:04Z",allocate=function() return "11111111-1111-4111-8111-111111111111" end,extract=function() return {status="pending",reason="unavailable"} end,
        records={{key="native",selection="range",kind="highlight",start={type="xpointer",value="a"},["end"]={type="xpointer",value="b"},quote="synthetic",note="",chapter=json.null,native_timestamp=json.null}}}
end
local view=setmetatable({ui={document={file="/synthetic/book.epub"},doc_props={display_title="Synthetic"}}},Entry); view:init(); view:attach(app,adapter); view:onReaderReady()
assert(wire.decode(db.outbox[1]).payload.metadata.value.title=="Synthetic")
ack_bytes=wire.encode({schema_version=1,instance_id=id,device_id=device,source_id=source,reset_generation=0,current_reset_generation=0,seq=1,kind="source_snapshot",status="applied",results={metadata="applied"}})
assert(app:source_metadata_ack(ack_bytes))
view:onPageUpdate(1); view:onDocumentRerendered(); view:onPageUpdate(2); view:onPageUpdate(3)
assert(wire.decode(db.outbox[2]).payload.events[1].credited_characters==2)
view:onAnnotationsModified({}); assert(wire.decode(db.outbox[3]).payload.annotations.value[1].quote=="synthetic")
-- Reset legacy baseline is stored offline, then released only by trusted metadata ACK.
local reset_db={rows={},outbox={}}; setmetatable(reset_db,{__index=db})
local reset_config=copy(config); reset_config.reset_generation=1
local reset_app=app_factory.open(reset_db,nil,reset_config,device,nil,{root="/synthetic",read_file=function() return zone end},function(bytes) return bytes==ack_bytes end)
local reset_adapter={source=function() return {verified=true,reset=true,source_id=source,metadata={format="epub",title="Synthetic",authors={},language=json.null,identifiers={}},captured_at="2026-01-01T00:00:00Z"} end}
local legacy_duration=5
function reset_adapter:legacy()
    local done=false
    local conn={prepare=function() return {bind1=function() end,step=function() if done then return nil end; done=true; return {1,1767225600,legacy_duration,10} end,close=function() end} end,close=function() end}
    return {verified=true,source_id=source,connection=conn,owned=true,binding={verified=true,readonly=true,source_id=source,native_book_id=1,epoch=id,epoch_verified=true},uuid=function() return device end,captured_at="2026-01-01T00:00:01Z"}
end
local reset_view=setmetatable({ui={}},Entry); reset_view:init(); reset_view:attach(reset_app,reset_adapter); reset_view:onReaderReady()
assert(reset_db.outbox[1] and not reset_db.outbox[2] and reset_db.rows["legacy_barrier:"..source])
ack_bytes=wire.encode({schema_version=1,instance_id=id,device_id=device,source_id=source,reset_generation=1,current_reset_generation=1,seq=1,kind="source_snapshot",status="applied",results={metadata="applied"}})
assert(reset_view:metadata_ack(ack_bytes)); assert(wire.decode(reset_db.outbox[2]).payload.mode=="baseline")
ack_bytes=wire.encode({schema_version=1,instance_id=id,device_id=device,source_id=source,reset_generation=1,current_reset_generation=1,seq=2,kind="legacy_statistics",status="applied",results={legacy_statistics="applied"}})
assert(reset_view:legacy_ack(ack_bytes) and reset_view:legacy_ack(ack_bytes)); reset_view:refreshLegacy()
assert(not reset_db.outbox[3], "unchanged statistics are not queued again")
legacy_duration=6; reset_view:refreshLegacy(); assert(wire.decode(reset_db.outbox[3]).payload.mode=="snapshot")
print("KOReader entry to application assertions passed")
