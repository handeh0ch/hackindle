package.path = "plugin/?.lua;" .. package.path
package.preload["ui/widget/container/widgetcontainer"] = function()
    return {extend=function(_, spec) spec.__index=spec; return spec end}
end
local Entry=dofile("plugin/main.lua")
local meta=dofile("plugin/_meta.lua")
assert(meta.name=="kindle_sync" and type(meta.fullname)=="string")
local view=setmetatable({ui={}},Entry)
view:init()
assert(view.status=="adapter_unavailable")
assert(view:onPageUpdate(1)==nil and view:onAnnotationsModified({})==nil)
local events={}
local app={}
function app:source_snapshot(source,metadata,progress,at) events[#events+1]={"source",source,metadata.title,at} end
function app:reading_sample(sample,adapter,at) events[#events+1]={"reading",sample.page,at} end
function app:annotations_snapshot(source,records,allocate,extract,at) events[#events+1]={"annotations",source,#records,at} end
function app:reset_source_metadata(source,metadata,at) events[#events+1]={"reset_source",source,at} end
function app:annotation_reset_saved(source,key,event_id) events[#events+1]={"save",key,event_id} end
function app:annotation_reset_snapshot(source,ticket,records,allocate,extract,at) events[#events+1]={"reset_annotations",ticket,#records} end
function app:session_open(source,cycle,at,uuid,verified) events[#events+1]={"open",source,verified} end
function app:session_close(at,uuid,verified) events[#events+1]={"close",verified} end
local adapter={}
function adapter:source(ui) return {verified=true,source_id=("a"):rep(64),metadata={title="Synthetic"},captured_at="time"} end
function adapter:begin_page(ui,page) return {page=page,verified=true,durable=true} end
function adapter:discard_page(ui,token) return true end
function adapter:finish_page(ui,token,next_page) return {verified=true,sample={page=token.page,source=("a"):rep(64),source_id=("a"):rep(64)},adapter={},captured_at="time"} end
function adapter:annotations(ui,change) return {verified=true,complete=true,source_id=("a"):rep(64),records={},allocate=function() end,extract=function() end,captured_at="time"} end
assert(view:attach(app,adapter))
assert(view:onReaderReady()==nil and events[1][1]=="source")
view:onPageUpdate(1); view:onDocumentRerendered(); view:onPageUpdate(2)
assert(#events==1)
view:onPageUpdate(3)
assert(#events==2 and events[2][1]=="reading" and events[2][2]==2)
view:onAnnotationsModified({})
assert(events[3][1]=="annotations")
view:onSuspend(); assert(events[4][1]=="reading" and events[4][2]==3)
view:onPageUpdate(4); view:onCloseDocument(); assert(#events==4)
view:onResume(); view:onReaderReady(); view:onPageUpdate(5); view:onCloseDocument()
assert(events[6][1]=="reading" and events[6][2]==5)
adapter.source=function() return {verified=true,reset=true,source_id=("a"):rep(64),metadata={title="Synthetic"},captured_at="time"} end
adapter.lifecycle=function(_,ui,event) return {verified=true,source_id=("a"):rep(64),cycle_id="cycle",captured_at="time",uuid=function() end} end
view:onReaderReady(); assert(events[7][1]=="reset_source" and events[8][1]=="open" and events[8][3]==true)
adapter.annotations=function() return {verified=true,reset=true,source_id=("a"):rep(64),save={key="key",event_id="event"}} end
view:onAnnotationsModified({}); assert(events[9][1]=="save")
adapter.annotations=function() return {verified=true,reset=true,complete=true,source_id=("a"):rep(64),ticket=1,records={},allocate=function() end,extract=function() end,captured_at="time"} end
view:onAnnotationsModified({}); assert(events[10][1]=="reset_annotations")
view:onSuspend(); assert(events[11][1]=="close" and events[11][2]==true)
adapter.source=function() error("private data must not be logged") end
local prior_events=#events
view:onReaderReady(); assert(view.status=="capture_unavailable" and #events==prior_events)
view:onResume(); view:onPageUpdate(6); view:onAnnotationsModified({})
assert(view.pending_page==nil and #events==prior_events)
local failed=setmetatable({ui={}},Entry); failed:init()
local failing={source=function() return {verified=true,source_id=("a"):rep(64),metadata={title="Synthetic"},captured_at="time"} end,
    begin_page=function(_,ui,page) return {page=page,verified=true,durable=true} end,
    finish_page=function() error("unavailable") end}
assert(failed:attach(app,failing)); failed:onReaderReady(); failed:onPageUpdate(1); failed:onPageUpdate(2)
assert(failed.pending_page.page==1 and failed.status=="capture_unavailable" and failed.capture_gap and failed.deferred_page==2)
failed:onDocumentRerendered(); assert(failed.pending_page.page==1)
failed:onCloseDocument(); local before=#events; failed:onReaderReady()
assert(#events==before and failed.status=="reconciliation_required" and failed.pending_page.page==1)
assert(not pcall(function() failed:attach(app,failing) end))
-- A failed close must retain the runtime and its adapter for an explicit retry.
local retry=setmetatable({ui={}},Entry); retry:init()
local fail_close=true; local closes=0
local retry_adapter={source=failing.source,begin_page=failing.begin_page,
    finish_page=function(_,ui,token)
        if fail_close then error("temporarily unavailable") end
        return {verified=true,sample={source=("a"):rep(64),source_id=("a"):rep(64)},adapter={},captured_at="time"}
    end}
assert(retry:attach(app,retry_adapter)); retry.runtime={close=function() closes=closes+1 end}
retry:onReaderReady(); retry:onPageUpdate(1); retry:onCloseDocument()
assert(retry.pending_page and retry.adapter==retry_adapter and retry.runtime and closes==0 and not retry.closed)
fail_close=false; retry:onCloseDocument()
assert(retry.pending_page==nil and retry.adapter==nil and retry.runtime==nil and retry.closed and closes==1)
local abandoned=setmetatable({ui={}},Entry); abandoned:init()
local gap_count=0
local abandon_adapter={source=failing.source,begin_page=failing.begin_page,finish_page=function() error("document gone") end,
    abandon_page=function(_,token) assert(token.page==1); gap_count=gap_count+1; return true end}
assert(abandoned:attach(app,abandon_adapter)); abandoned.runtime={close=function() end}; abandoned:onReaderReady(); abandoned:onPageUpdate(1)
abandoned.ui={}; abandoned:onCloseDocument(); assert(abandoned.closed and not abandoned.pending_page and gap_count==1)
local suspended_retry=setmetatable({ui={}},Entry); suspended_retry:init()
fail_close=true; assert(suspended_retry:attach(app,retry_adapter)); suspended_retry:onReaderReady(); suspended_retry:onPageUpdate(1)
suspended_retry:onSuspend(); assert(suspended_retry.suspended and suspended_retry.pending_page)
suspended_retry:onCloseDocument(); assert(suspended_retry.pending_page and not suspended_retry.closed)
fail_close=false; suspended_retry:onResume(); assert(not suspended_retry.suspended and not suspended_retry.pending_page)
-- Page updates while hashing establish only the current page, never past duration.
local delayed=setmetatable({ui={}},Entry); delayed:init()
local source_callback
delayed.runtime={app=app,start_source=function(_,ui,callback) source_callback=callback end}
delayed:onReaderReady(); delayed:onPageUpdate(1); delayed:onPageUpdate(2)
assert(delayed.capture_gap and delayed.pending_page==nil)
source_callback({source=failing.source,begin_page=function(_,ui,page) return {page=page,verified=true,durable=true} end})
assert(delayed.pending_page and delayed.pending_page.page==2 and delayed.capture_gap)
local vocab_view=setmetatable({ui={}},Entry); vocab_view:init()
local vocabulary_captures=0
local vocab_app={source_snapshot=app.source_snapshot,vocabulary_snapshot=function(_,read) local words=read(); assert(words[1].word=="term"); vocabulary_captures=vocabulary_captures+1; return true end}
local vocab_adapter={source=failing.source,vocabulary=function() return {verified=true,captured_at="time",read=function() return {{word="term"}} end} end}
assert(vocab_view:attach(vocab_app,vocab_adapter)); vocab_view:onReaderReady(); vocab_view:onSuspend()
assert(vocabulary_captures==1)
local reset_vocab=setmetatable({ui={}},Entry); reset_vocab:init()
local reset_steps={}
local reset_app={reset_source_metadata=app.reset_source_metadata,begin_vocabulary_reset=function() reset_steps[#reset_steps+1]="ticket"; return 7 end,
    vocabulary_reset_baseline=function(_,ticket,words) assert(ticket==7 and words[1].word=="term"); reset_steps[#reset_steps+1]="baseline"; return {} end,
    vocabulary_reset_ack=function(_,bytes) return bytes=="trusted" end,begin_vocabulary_read=function() return 8 end,
    vocabulary_reset_snapshot=function(_,ticket,words) assert(ticket==8 and words[1].word=="term"); reset_steps[#reset_steps+1]="snapshot"; return true end}
local reset_adapter={source=function() return {verified=true,reset=true,source_id=("a"):rep(64),metadata={},captured_at="time"} end,vocabulary=vocab_adapter.vocabulary}
assert(reset_vocab:attach(reset_app,reset_adapter)); reset_vocab:onReaderReady(); assert(table.concat(reset_steps,",")=="ticket,baseline")
assert(not reset_vocab:vocabulary_ack("forged")); assert(reset_vocab:vocabulary_ack("trusted")); reset_vocab:refreshVocabulary()
assert(table.concat(reset_steps,",")=="ticket,baseline,snapshot")
local reset_ann=setmetatable({ui={}},Entry); reset_ann:init()
local ann_steps={}
local ann_app={reset_source_metadata=app.reset_source_metadata,begin_annotation_reset=function() ann_steps[#ann_steps+1]="ticket"; return 4 end,
    annotation_reset_baseline=function(_,source,ticket,records) assert(ticket==4 and #records==1); ann_steps[#ann_steps+1]="baseline"; return true end,
    begin_annotation_read=function() return 5 end,annotation_reset_snapshot=function(_,source,ticket,records) assert(ticket==5 and #records==1); ann_steps[#ann_steps+1]="snapshot" end}
local ann_adapter={source=reset_adapter.source,annotations=function() return {verified=true,reset=true,complete=true,source_id=("a"):rep(64),records={{key="key"}},allocate=function() end,extract=function() end,captured_at="time"} end}
assert(reset_ann:attach(ann_app,ann_adapter)); reset_ann:onReaderReady(); reset_ann:onAnnotationsModified({})
assert(table.concat(ann_steps,",")=="ticket,baseline,snapshot")
local reset_legacy=setmetatable({ui={}},Entry); reset_legacy:init()
local legacy_steps={}; local legacy_conn={close=function() legacy_steps[#legacy_steps+1]="close" end}
local legacy_app={reset_source_metadata=app.reset_source_metadata,begin_legacy_baseline=function() legacy_steps[#legacy_steps+1]="ticket"; return 3 end,
    legacy_native_records=function() legacy_steps[#legacy_steps+1]="read"; return {} end,
    legacy_baseline=function(_,source,value,baseline,ticket) assert(value.epoch=="epoch" and baseline=="baseline" and ticket==3); legacy_steps[#legacy_steps+1]="baseline"; return {} end,
    legacy_ack=function(_,bytes) return bytes=="trusted" end,legacy_snapshot=function(_,source,value) assert(value.epoch=="epoch"); legacy_steps[#legacy_steps+1]="snapshot"; return true end}
local legacy_adapter={source=reset_adapter.source,legacy=function() return {verified=true,source_id=("a"):rep(64),connection=legacy_conn,owned=true,binding={epoch="epoch",epoch_verified=true},uuid=function() return "baseline" end,captured_at="time"} end}
assert(reset_legacy:attach(legacy_app,legacy_adapter)); reset_legacy:onReaderReady()
assert(table.concat(legacy_steps,",")=="ticket,read,close,baseline")
assert(not reset_legacy:legacy_ack("forged") and reset_legacy:legacy_ack("trusted")); reset_legacy:refreshLegacy()
assert(table.concat(legacy_steps,",")=="ticket,read,close,baseline,read,close,snapshot")
local reset_reading=setmetatable({ui={}},Entry); reset_reading:init()
local reading_steps={}
local reading_app={reset_source_metadata=app.reset_source_metadata,begin_reading_reset=function() reading_steps[#reading_steps+1]="ticket"; return 9 end,
    reading_reset_baseline=function(_,source,ticket,value,compare) assert(ticket==9 and value.verified and compare(1,2)<0); reading_steps[#reading_steps+1]="baseline"; return true end}
local reading_adapter={source=reset_adapter.source,reading_baseline=function() return {verified=true,epoch="epoch",native={},ranges={},compare=function(a,b) return a-b end} end}
assert(reset_reading:attach(reading_app,reading_adapter)); reset_reading:onReaderReady(); assert(table.concat(reading_steps,",")=="ticket,baseline")
local sentinel=setmetatable({ui={}},Entry); sentinel:init()
local sentinel_count=0
local sentinel_adapter={source=failing.source,begin_page=function(_,ui,page) assert(page~=false); return {page=page,verified=true,durable=true} end,
    finish_page=function(_,ui,token) sentinel_count=sentinel_count+1; return {verified=true,sample={source=("a"):rep(64),source_id=("a"):rep(64)},adapter={},captured_at="time"} end}
assert(sentinel:attach(app,sentinel_adapter)); sentinel:onReaderReady(); sentinel:onPageUpdate(1); sentinel:onPageUpdate(false)
assert(sentinel_count==1 and sentinel.pending_page==nil and sentinel.status=="ready")
sentinel:onPageUpdate(nil); assert(sentinel.pending_page==nil and sentinel.status=="capture_unavailable")
local unsafe=setmetatable({ui={}},Entry); unsafe:init()
local incomplete={source=failing.source,begin_page=function() return {page=1} end}
assert(unsafe:attach(app,incomplete)); unsafe:onReaderReady(); unsafe:onPageUpdate(1)
assert(unsafe.pending_page==nil and unsafe.status=="capture_unavailable")
local rollback=setmetatable({ui={}},Entry); rollback:init()
local no_discard={source=failing.source,begin_page=function() return {page=1,verified=true,durable=true} end,discard_page=function() return false end}
assert(rollback:attach(app,no_discard)); rollback:onReaderReady(); rollback:onPageUpdate(1); rollback:onDocumentRerendered()
assert(rollback.pending_page and rollback.status=="capture_unavailable")
local event_count=#events; rollback:onReaderReady()
assert(#events==event_count and rollback.status=="reconciliation_required")
local mixed=setmetatable({ui={}},Entry); mixed:init()
local mixed_adapter={source=failing.source,begin_page=function() return {verified=true,durable=true} end,
    finish_page=function() return {verified=true,sample={source=("b"):rep(64),source_id=("b"):rep(64)},adapter={},captured_at="time"} end}
assert(mixed:attach(app,mixed_adapter)); mixed:onReaderReady(); mixed:onPageUpdate(1)
local before_mixed=#events; mixed:onPageUpdate(2)
assert(#events==before_mixed and mixed.pending_page and mixed.status=="capture_unavailable")
print("KOReader entry event assertions passed")
