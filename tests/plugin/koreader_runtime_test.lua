package.path="projects/plugin/?.lua;"..package.path
local runtime=require("koreader.koreader_runtime")
local json=require("protocol.wire_json")
local id="48bc0344-efad-4c68-adb6-dc0f0ba57276"
local source=("a"):rep(64)
local db={rows={},outbox={}}
local function clone(t) local out={}; for k,v in pairs(t) do out[k]=v end; return out end
function db:exec(sql,args)
    if sql=="BEGIN IMMEDIATE" then self.backup={rows=clone(self.rows),outbox=clone(self.outbox)}
    elseif sql=="ROLLBACK" then self.rows=self.backup.rows; self.outbox=self.backup.outbox
    elseif sql:match("INSERT OR REPLACE INTO capture_state") then self.rows[args[1]]=args[2]
    elseif sql:match("INSERT INTO outbox") then self.outbox[args[1]]=args[2] end
end
function db:one(sql,args) return self.rows[args[1]] end
local function u32(n) return string.char(math.floor(n/16777216)%256,math.floor(n/65536)%256,math.floor(n/256)%256,n%256) end
local function header() return "TZif2"..string.rep("\0",15)..u32(0)..u32(0)..u32(0)..u32(0)..u32(1)..u32(4) end
local block=u32(0)..string.char(0,0).."UTC\0"
local zone=header()..block..header()..block.."\nUTC0\n"
local config={schema_version=1,instance_id=id,reporting_timezone="UTC",characters_per_page=2000,reset_generation=0,unicode_version=require("text.unicode_lower").version}
local scheduled={}
local calls,canceled=0,0
local unchanged=true
local function job()
    local n=0
    return {step=function() calls=calls+1; n=n+1; if n==1 then return false end; return {verified=true,source_id=source,format="epub",unchanged=function() return unchanged end} end,
        cancel=function() canceled=canceled+1; return true end}
end
local ack_bytes
local deps={db=db,authenticated_profile=function() return true end,uuid=function() return id end,
    zoneinfo={root="/synthetic",read_file=function() return zone end},
    resolve_format=function() return {verified=true,format="epub"} end,
    schedule=function(f) scheduled[#scheduled+1]=f end,begin_file=function() return job() end,
    utc_now=function() return "2026-01-01T00:00:00Z" end,authenticated_ack=function(bytes) return bytes==ack_bytes end}
deps.native={begin_page=function(_,ui,page) return "begin-"..page end,finish_page=function() return "finished" end}
assert(not pcall(function() runtime.open(config,{db=db,zoneinfo=deps.zoneinfo}) end))
assert(db.rows.device_id==nil)
local r=runtime.open(config,deps); assert(db.rows.device_id==id and not r:has_gap())
assert(r:record_gap()==1 and r:has_gap())
local ui={document={file="/synthetic/book.epub"},doc_props={display_title="Synthetic"}}
local result
r:start_source(ui,function(adapter) result=adapter end)
assert(result==nil and #scheduled==1 and calls==0)
table.remove(scheduled,1)(); assert(result==nil and #scheduled==1 and calls==1)
table.remove(scheduled,1)(); assert(result and calls==2)
local packet=result:source(ui); assert(packet.source_id==source and packet.metadata.language==json.null)
assert(result:begin_page(ui,3)=="begin-3" and result:finish_page(ui,{})=="finished")
local vocab_closed=false
deps.vocabulary_connection=function() return {prepare=function() local done=false; return {step=function() if done then return nil end; done=true; return {"term"} end,close=function() end} end,close=function() vocab_closed=true end} end
local vocab=result:vocabulary(); local words=vocab.read(); assert(vocab_closed and words[1].word=="term" and vocab.verified)
unchanged=false; assert(not pcall(function() result:begin_page(ui,4) end)); assert(not pcall(function() result:source(ui) end)); unchanged=true
r:start_source(ui,function() error("canceled callback") end); r:cancel_source(); assert(canceled==1)
table.remove(scheduled,1)(); assert(calls==2)
local corrupt={rows={seq="1"},outbox={}}; setmetatable(corrupt,{__index=db})
local invalid=clone(deps); invalid.db=corrupt
assert(not pcall(function() runtime.open(config,invalid) end))
package.preload["ui/widget/container/widgetcontainer"]=function() return {extend=function(_,spec) spec.__index=spec; return spec end} end
local Entry=dofile("projects/plugin/main.lua")
ui.annotation={annotations={{pos0="/a",pos1="/b",text="synthetic",note="note"}}}
deps.annotation_binding=function() return {verified=true,complete=true,source_id=source,format="epub",key_for=function() return {verified=true,key="stable-key"} end} end
deps.legacy_binding=function() return {verified=true,readonly=true,source_id=source,native_book_id=1} end
deps.legacy_connection=function() return {prepare=function()
    local done=false
    return {bind1=function() end,step=function() if done then return nil end; done=true; return {1,1767225600,5,100} end,close=function() end}
end} end
local view=setmetatable({ui=ui},Entry); view:init()
local blocked=clone(deps); blocked.authenticated_profile=function() return false end
assert(not view:configure(config,blocked) and view.status=="initialization_unavailable")
assert(view:configure(config,deps) and view.capture_gap); view:onReaderReady()
local serial=0; deps.uuid=function() serial=serial+1; return string.format("10000000-0000-4000-8000-%012d",serial) end
assert(view.status=="source_pending" and #scheduled==1)
table.remove(scheduled,1)(); table.remove(scheduled,1)()
assert(view.source_ready and require("protocol.codec").decode(db.outbox[1]).payload.metadata.value.title=="Synthetic")
assert(not view.lifecycle_pending)   -- the queued metadata snapshot is enough to open the session
assert(not view:metadata_ack("forged") and db.outbox[5]==nil)
ack_bytes=require("protocol.codec").encode({schema_version=1,instance_id=id,device_id=id,source_id=source,reset_generation=0,current_reset_generation=0,seq=1,kind="source_snapshot",status="applied",results={metadata="applied"}})
assert(view:metadata_ack(ack_bytes) and not view.lifecycle_pending)
assert(require("protocol.codec").decode(db.outbox[2]).payload.events[1].type=="session_started")
assert(require("protocol.codec").decode(db.outbox[3]).payload.annotations.value[1].quote=="synthetic")
assert(require("protocol.codec").decode(db.outbox[4]).payload.records[1].native_seconds==5)
assert(view:metadata_ack(ack_bytes) and db.outbox[5]==nil)
local other=setmetatable({ui=ui},Entry); other:init(); assert(other:configure(config,deps)); other:onReaderReady()
other:onCloseDocument(); local prior=calls; table.remove(scheduled,1)(); assert(calls==prior and other.closed)
local switched=setmetatable({ui=ui},Entry); switched:init(); assert(switched:configure(config,deps)); switched:onReaderReady()
ui.document.file="/synthetic/other.epub"
table.remove(scheduled,1)(); assert(switched.status=="source_unavailable" and not switched.source_ready)
ui.document.file="/synthetic/book.epub"
local sleeping=setmetatable({ui=ui},Entry); sleeping:init(); assert(sleeping:configure(config,deps)); sleeping:onReaderReady()
sleeping:onSuspend(); local before_sleep=calls; table.remove(scheduled,1)(); assert(calls==before_sleep)
local before_resume=tonumber(db.rows.seq)
sleeping:onResume(); assert(#scheduled==1); table.remove(scheduled,1)(); table.remove(scheduled,1)()
assert(sleeping.source_ready)
local found_annotation,found_legacy=false,false
for seq=before_resume+1,tonumber(db.rows.seq) do
    local packet=require("protocol.codec").decode(db.outbox[seq])
    found_annotation=found_annotation or (packet.kind=="source_snapshot" and packet.payload.annotations~=nil)
    found_legacy=found_legacy or packet.kind=="legacy_statistics"
end
assert(found_annotation and found_legacy)
-- Exercise the shipped CRE reader through entrypoint and real application state.
local fresh={rows={},outbox={}}; setmetatable(fresh,{__index=db})
local native_deps=clone(deps); native_deps.db=fresh; native_deps.native=nil; native_deps.annotation_binding=nil; native_deps.legacy_binding=function() return {verified=true,readonly=true,source_id=source,native_book_id=7,epoch_verified=true,epoch=id} end
local next_id=0; native_deps.uuid=function() next_id=next_id+1; return string.format("20000000-0000-4000-8000-%012d",next_id) end
local reader={document={file="/synthetic/book.epub",getPageCount=function() return 4 end,getPageXPointer=function(_,n) return tostring(n) end,
    getXPointer=function() return "here" end,compareXPointers=function(_,a,b) local d=tonumber(b)-tonumber(a); return d<0 and -1 or (d>0 and 1 or 0) end,
    getTextFromXPointers=function() return "abc" end},doc_props={display_title="Synthetic"},highlight={}}
reader.statistics={document=reader.document,is_doc=true,id_curr_book=7,curr_page=1,page_stat={[1]={{1767225600,0}}}}
local integrated=setmetatable({ui=reader},Entry); integrated:init(); assert(integrated:configure(config,native_deps)); integrated:onReaderReady()
table.remove(scheduled,1)(); table.remove(scheduled,1)()
integrated:onPageUpdate(1); assert(integrated.pending_page and integrated.deferred_page==nil)   -- no wait for the acknowledgement
local first_packet=require("protocol.codec").decode(fresh.outbox[1])
ack_bytes=require("protocol.codec").encode({schema_version=1,instance_id=id,device_id=fresh.rows.device_id,source_id=source,reset_generation=0,current_reset_generation=0,seq=first_packet.seq,kind="source_snapshot",status="applied",results={metadata="applied"}})
assert(integrated:metadata_ack(ack_bytes)); assert(integrated.pending_page)
reader.statistics.page_stat[1][1][2]=5
integrated:onPageUpdate(2); assert(integrated.pending_page)
local reading_event
for _,bytes in pairs(fresh.outbox) do local packet=require("protocol.codec").decode(bytes); if packet.kind=="reading_events" and packet.payload.events[1].type=="reading_segment" then reading_event=packet.payload.events[1] end end
assert(reading_event and reading_event.credited_characters==3 and reading_event.native_seconds==5 and reading_event.provenance=="koreader_statistics")
integrated.runtime:close()
local pdf_db={rows={},outbox={}}; setmetatable(pdf_db,{__index=db})
local pdf_deps=clone(native_deps); pdf_deps.db=pdf_db; pdf_deps.resolve_format=function() return {verified=true,format="pdf"} end
pdf_deps.begin_file=function() return {step=function() return {verified=true,source_id=source,format="pdf",unchanged=function() return true end} end,cancel=function() end} end
local pdf_reader={document={file="/synthetic/book.pdf",getPageCount=function() return 3 end},doc_props={display_title="Synthetic"}}
pdf_reader.statistics={document=pdf_reader.document,is_doc=true,id_curr_book=7,curr_page=1,page_stat={[1]={{1767225600,0}}}}
local pdf_view=setmetatable({ui=pdf_reader},Entry); pdf_view:init(); assert(pdf_view:configure(config,pdf_deps)); pdf_view:onReaderReady(); table.remove(scheduled,1)()
ack_bytes=require("protocol.codec").encode({schema_version=1,instance_id=id,device_id=pdf_db.rows.device_id,source_id=source,reset_generation=0,current_reset_generation=0,seq=1,kind="source_snapshot",status="applied",results={metadata="applied"}})
assert(pdf_view:metadata_ack(ack_bytes)); pdf_view:onPageUpdate(1); pdf_reader.statistics.page_stat[1][1][2]=8; pdf_view:onPageUpdate(2)
local pdf_event
for _,bytes in pairs(pdf_db.outbox) do local packet=require("protocol.codec").decode(bytes); if packet.kind=="reading_events" and packet.payload.events[1].type=="reading_segment" then pdf_event=packet.payload.events[1] end end
assert(pdf_event and pdf_event.native_seconds==8 and pdf_event.credited_characters==json.null and #pdf_event.ranges==0)
pdf_view.runtime:close()
fresh.rows.native_page=require("protocol.codec").encode({event_id=id,source=source})
local recovery=require("koreader.capture.koreader_reading").new(fresh,{},source,native_deps.uuid,native_deps.utc_now)
assert(recovery:recover()); recovery:close()
local restarted_once=runtime.open(config,native_deps); assert(restarted_once:has_gap()); restarted_once:close()
local restarted_twice=runtime.open(config,native_deps); assert(restarted_twice:has_gap()); restarted_twice:close()
-- UIManager runs scheduled tasks without pcall: nothing raised in a step or in the caller's callback may escape.
while #scheduled>0 do table.remove(scheduled) end
local guarded=runtime.open(config,deps)
local delivered={}
guarded:start_source(ui,function(adapter,reason) delivered[#delivered+1]=adapter and "adapter" or reason; error("callback failed") end)
table.remove(scheduled,1)()
assert(pcall(table.remove(scheduled,1)) and delivered[1]=="adapter" and #delivered==1, "a raising callback must not escape the step")
local original_native=deps.native
deps.native=5
local failed_steps={}
guarded:start_source(ui,function(adapter,reason) failed_steps[#failed_steps+1]=adapter and "adapter" or reason end)
table.remove(scheduled,1)()
assert(pcall(table.remove(scheduled,1)) and failed_steps[1]=="source_unavailable" and #failed_steps==1, "an unexpected error ends the source, not the reader")
deps.native=original_native
guarded:close()
print("KOReader runtime assertions passed")
