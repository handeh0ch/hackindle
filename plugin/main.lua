-- KOReader WidgetContainer event entrypoint. Native evidence and authenticated
-- provisioning remain injected; missing adapters never generate measurements.
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local Entry = WidgetContainer:extend{ name = "kindle_sync", is_doc_only = true }
-- KOReader's logger is optional so that errors never become a second failure.
-- Only error text is logged: assertions here carry no credentials or book content.
local has_logger,logger = pcall(require, "logger")
local function warn(...)
    if has_logger and type(logger)=="table" and type(logger.warn)=="function" then pcall(logger.warn, "KindleSync:", ...) end
end

function Entry:init()
    self.status = "adapter_unavailable"
    self.pending_page = nil
    self.pending_is_latest = false
    self.suspended = false
    self.closed = false
    self.closing = false
    self.source_ready = false
    self.source_id = nil
    self.capture_gap = false
    self.deferred_page = nil
    self:startSync()
    if type(self.ui) == "table" and type(self.ui.menu) == "table" and type(self.ui.menu.registerToMainMenu) == "function" then
        self.ui.menu:registerToMainMenu(self)
    end
end

-- Server connection (settings file, profile cache, delivery timer). Without the
-- owner's settings file this does nothing and capture stays unconfigured.
function Entry:startSync(modules)
    local ok, client = pcall(function() return require("koreader_client").start(self, modules) end)
    if ok then self.sync = client or nil
    else self.sync_error = tostring(client); warn("sync unavailable:", client) end
end

-- Applies a verified acknowledgement to capture state. The delivery layer calls
-- this inside its authentic scope; every hook below is idempotent.
function Entry:applyAck(packet, bytes)
    local app = self.app or (self.runtime and self.runtime.app)
    if not app then error("capture state unavailable", 0) end
    if packet.kind == "source_snapshot" then
        if not self.closing and self.source_ready and self.source_id == packet.source_id then self:metadata_ack(bytes)
        elseif packet.reset_generation == 0 then app:source_metadata_ack(bytes)
        else app:reset_source_metadata_ack(bytes) end
    elseif packet.kind == "legacy_statistics" then
        if not self.closing and self.source_ready and self.source_reset then self:legacy_ack(bytes) else app:legacy_ack(bytes) end
    elseif packet.kind == "vocabulary_snapshot" then app:vocabulary_reset_ack(bytes) end
end

function Entry:addToMainMenu(menu_items)
    menu_items.kindle_sync = {
        text = "Kindle Sync", sorting_hint = "tools",
        sub_item_table = {
            {text = "Status", keep_menu_open = true, callback = function()
                self:guarded(function()
                    self:notify(self.sync and self.sync:summary() or "Not configured: place kindle_sync.conf in the KOReader settings folder.")
                end)
            end},
            {text = "Sync now", enabled_func = function() return self.sync ~= nil end, callback = function()
                self:guarded(function() if self.sync then self.sync:sync_now() end end)
            end},
            {text = "Mark book as finished", enabled_func = function() return self.source_ready == true end, callback = function()
                local done = self:finishBook()
                self:notify(done and "Book marked as finished." or "Not recorded: already finished or capture unavailable.")
            end},
            {text = "Start new read cycle", enabled_func = function() return self.source_ready == true end, callback = function()
                local done = self:startNewCycle()
                self:notify(done and "New read cycle started." or "Not started: capture unavailable.")
            end},
        },
    }
end

-- KOReader runs menu callbacks without pcall; an error here would end the reader.
function Entry:guarded(work)
    local ok, err = pcall(work)
    if not ok then warn("menu action failed:", err); self:notify("Kindle Sync action failed. See the log.") end
    return ok
end

function Entry:notify(text)
    local ok, err = pcall(function()
        require("ui/uimanager"):show(require("ui/widget/infomessage"):new{text = text})
    end)
    if not ok then warn("message could not be shown:", err) end
end

function Entry:attach(app, adapter)
    assert(type(app)=="table" and type(adapter)=="table", "capture adapter unavailable")
    assert(not self.pending_page, "pending reading observation requires reconciliation")
    self.app, self.adapter = app, adapter
    if adapter.recovered_gap then self.capture_gap=true end
    self.pending_page = nil
    self.source_ready = false
    self.source_id = nil
    self.status = "ready"
    return true
end

-- P2 supplies the authenticated profile, timezone provider and ACK verifier.
-- No network activity or configuration is started by this entrypoint.
function Entry:configure(config,deps)
    if self.runtime or self.pending_page then self.status="initialization_unavailable"; return false end
    local ok,runtime=pcall(function() return require("koreader_runtime").open(config,deps) end)
    if not ok then self.status="initialization_unavailable"; self.last_error=tostring(runtime); warn("initialization failed:",runtime); return false end
    self.runtime=runtime
    if runtime:has_gap() then self.capture_gap=true end
    self.status="source_pending"
    return true
end

function Entry:call(fn)
    local ok,err = pcall(fn)
    if not ok then self.status="capture_unavailable"; self.last_error=tostring(err); warn("capture step failed:",err) end
    return ok
end

function Entry:onReaderReady()
    if self.pending_page then self.source_ready=false; self.status="reconciliation_required"; return end
    self.closed=false
    self.source_ready=false
    self.source_id=nil
    self.scroll_noted=false; self.scroll_mode=false
    if self.runtime and not self.app then
        local reader=self.ui
        self.status="source_pending"
        self.runtime:start_source(reader,function(adapter)
            if self.closed or self.suspended or self.ui~=reader then return end
            if not adapter then self.status="source_unavailable"; return end
            self:attach(self.runtime.app,adapter)
            self:onReaderReady()
            local page=self.deferred_page; self.deferred_page=nil
            if page and self.source_ready then self:onPageUpdate(page) end
        end)
        return
    end
    if not self.app or not self.adapter then self.status="adapter_unavailable"; return end
    local reset,source_id=false,nil
    local ok=self:call(function()
        local value=self.adapter:source(self.ui)
        assert(type(value)=="table" and value.verified==true and type(value.source_id)=="string", "source unavailable")
        source_id=value.source_id
        reset=value.reset==true
        if value.reset then self.app:reset_source_metadata(value.source_id,value.metadata,value.captured_at)
        else self.app:source_snapshot(value.source_id,value.metadata,value.progress,value.captured_at) end
    end)
    if ok then
        self.source_ready=true; self.source_id=source_id; self.source_reset=reset
        if reset then self:baselineVocabulary(); self:baselineAnnotations(); self:baselineLegacy(); self:baselineReading() end
        self:lifecycle("open")
        if type(self.app.source_metadata_ready)=="function" then
            local checked,ready=pcall(self.app.source_metadata_ready,self.app,source_id)
            if checked and ready then self:import_source() end
        end
    end
end

function Entry:lifecycle(event)
    if not self.app or not self.adapter or type(self.adapter.lifecycle)~="function" then return end
    local ok=self:call(function()
        local value=self.adapter:lifecycle(self.ui,event)
        assert(type(value)=="table" and value.verified==true, "lifecycle unavailable")
        if event~="close" then assert(value.source_id==self.source_id, "lifecycle source mismatch") end
        if event=="close" then self.app:session_close(value.captured_at,value.uuid,true)
        else self.app:session_open(value.source_id,value.cycle_id,value.captured_at,value.uuid,true) end
    end)
    if event=="open" then self.lifecycle_pending=not ok end
end

-- The app accepts this only when its injected transport verifier authenticates
-- the exact ACK bytes. A rejected ACK cannot release the pending lifecycle.
function Entry:metadata_ack(bytes)
    if not self.app or not self.source_ready then return false end
    local ok,accepted=pcall(function()
        if self.source_reset then return self.app:reset_source_metadata_ack(bytes) end
        return self.app:source_metadata_ack(bytes)
    end)
    if not ok or accepted~=true then return false end
    if self.lifecycle_pending and not self.closed and not self.suspended then self:lifecycle("open") end
    if not self.lifecycle_pending and self.deferred_page and not self.pending_page and not self.closed and not self.suspended then
        local page=self.deferred_page; self.deferred_page=nil; self:onPageUpdate(page)
    end
    self:import_source()
    if self.source_reset and type(self.app.resume_legacy_baseline)=="function" then pcall(self.app.resume_legacy_baseline,self.app,self.source_id) end
    if self.source_reset and self.adapter and type(self.adapter.annotations)=="function" then self:onAnnotationsModified(nil) end
    return true
end

function Entry:import_source()
    if not self.source_reset and self.annotations_imported_source~=self.source_id and type(self.adapter.annotations)=="function" and not self.closed then self:onAnnotationsModified(nil) end
    if not self.source_reset and self.legacy_imported_source~=self.source_id and type(self.adapter.legacy)=="function" and not self.closed then
        self:call(function()
            local value=self.adapter:legacy(self.ui)
            assert(type(value)=="table" and value.verified==true and value.source_id==self.source_id, "native statistics unavailable")
            local ok,result=pcall(self.app.legacy_native_initial,self.app,value.source_id,value.connection,value.binding,value.captured_at)
            local closed=true
            if value.owned then closed=pcall(function() value.connection:close() end) end
            assert(ok and result and closed, "native statistics unavailable")
            self.legacy_imported_source=self.source_id
        end)
    end
end

function Entry:finishPage(next_page)
    if not self.pending_page then return true end
    local previous=self.pending_page
    local ok=self:call(function()
        local value=self.adapter:finish_page(self.ui,previous,next_page)
        assert(type(value)=="table" and value.verified==true and type(value.sample)=="table"
            and value.sample.source==self.source_id and value.sample.source_id==self.source_id, "reading unavailable")
        self.app:reading_sample(value.sample,value.adapter,value.captured_at)
        if type(self.adapter.commit_page)=="function" then assert(self.adapter:commit_page(previous)==true, "page commit unavailable") end
    end)
    if ok then self.pending_page=nil end
    return ok
end

function Entry:markCaptureGap()
    self.capture_gap=true
    if self.runtime and type(self.runtime.record_gap)=="function" then
        local ok,err=pcall(self.runtime.record_gap,self.runtime)
        if not ok then self.status="capture_unavailable"; self.last_error=tostring(err); warn("gap could not be recorded:",err) end
    end
end

function Entry:onPageUpdate(page)
    if self.suspended or self.closed then return end
    if not self.app or not self.adapter or not self.source_ready then
        if self.runtime and (page==false or (type(page)=="number" and page>=1 and page<=9007199254740991 and page==math.floor(page))) then
            self:markCaptureGap(); self.deferred_page=page~=false and page or nil
        end
        return
    end
    if page~=false and (type(page)~="number" or page<1 or page>9007199254740991 or page~=math.floor(page)) then self.status="capture_unavailable"; return end
    self.pending_is_latest=false
    self.scroll_noted=false; self.scroll_mode=false
    if not self:finishPage(page) then
        self:markCaptureGap(); self.deferred_page=page~=false and page or nil
        return
    end
    if page==false then return end
    local begun=self:call(function()
        local token=self.adapter:begin_page(self.ui,page)
        assert(type(token)=="table" and token.verified==true and token.durable==true, "visible page unavailable")
        self.pending_page=token
        self.pending_is_latest=true
    end)
    if not begun then self:markCaptureGap(); self.deferred_page=page end
end

-- Continuous scroll mode sends PosUpdate instead of PageUpdate (upstream source,
-- not verified on the device). Visible pages cannot be credited from it, so say
-- so once: close the page already shown and record a durable gap.
function Entry:onPosUpdate()
    if self.suspended or self.closed or not self.app or not self.adapter or not self.source_ready then return end
    if self.scroll_noted then return end
    self.scroll_noted=true; self.scroll_mode=true
    self:finishPage(false)
    self:markCaptureGap()
end

-- KOReader can emit PageUpdate immediately before DocumentRerendered. Never
-- count the new layout as a viewed page solely because of that update.
function Entry:onDocumentRerendered()
    if self.deferred_page then self.deferred_page=nil end
    if self.pending_is_latest then
        local ok=self:call(function() assert(self.adapter:discard_page(self.ui,self.pending_page)==true, "page invalidation unavailable") end)
        if ok then self.pending_page=nil; self.pending_is_latest=false end
    end
end

function Entry:onAnnotationsModified(change)
    if not self.app or not self.adapter or not self.source_ready or self.closed then return end
    local imported=false
    local ok=self:call(function()
        local value=self.adapter:annotations(self.ui,change)
        assert(type(value)=="table" and value.verified==true and value.source_id==self.source_id, "annotations unavailable")
        if value.reset then
            if value.save then self.app:annotation_reset_saved(value.source_id,value.save.key,value.save.event_id) end
            if value.records~=nil then
                assert(value.complete==true, "annotations unavailable")
                local ticket=value.ticket or self.app:begin_annotation_read(value.source_id)
                self.app:annotation_reset_snapshot(value.source_id,ticket,value.records,value.allocate,value.extract,value.captured_at)
            else assert(value.save~=nil, "annotations unavailable") end
        else
            assert(value.complete==true, "annotations unavailable")
            self.app:annotations_snapshot(value.source_id,value.records,value.allocate,value.extract,value.captured_at)
            imported=true
        end
    end)
    if ok and imported then self.annotations_imported_source=self.source_id end
end

function Entry:baselineReading()
    if not self.app or not self.adapter or type(self.adapter.reading_baseline)~="function" then return end
    self:call(function()
        if type(self.app.reading_baseline_ready)=="function" and self.app:reading_baseline_ready(self.source_id) then return end
        local ticket=self.app:begin_reading_reset(self.source_id)
        local value=self.adapter:reading_baseline(self.ui)
        assert(type(value)=="table" and value.verified==true and type(value.compare)=="function", "reading baseline unavailable")
        assert(self.app:reading_reset_baseline(self.source_id,ticket,value,value.compare), "reading baseline unavailable")
    end)
end

function Entry:readLegacy()
    local value=self.adapter:legacy(self.ui)
    assert(type(value)=="table", "legacy lineage unavailable")
    local ok,records=pcall(function()
        assert(value.verified==true and value.source_id==self.source_id and type(value.binding)=="table"
            and value.binding.epoch_verified==true and type(value.binding.epoch)=="string", "legacy lineage unavailable")
        return self.app:legacy_native_records(value.source_id,value.connection,value.binding)
    end)
    local closed=true
    if value.owned then closed=pcall(function() value.connection:close() end) end
    assert(ok and closed and type(records)=="table", "native statistics unavailable")
    return value,{verified=true,epoch=value.binding.epoch,records=records}
end
function Entry:baselineLegacy()
    if not self.app or not self.adapter or type(self.adapter.legacy)~="function" then return end
    self:call(function()
        local ticket=self.app:begin_legacy_baseline(self.source_id)
        local value,records=self:readLegacy()
        assert(type(value.uuid)=="function" and self.app:legacy_baseline(self.source_id,records,value.uuid(),ticket,value.captured_at), "legacy baseline unavailable")
    end)
end
function Entry:legacy_ack(bytes)
    if not self.app or not self.source_reset then return false end
    local ok,accepted=pcall(self.app.legacy_ack,self.app,bytes)
    return ok and accepted==true
end
function Entry:refreshLegacy()
    if not self.source_reset or not self.adapter or type(self.adapter.legacy)~="function" then return end
    self:call(function()
        local value,records=self:readLegacy()
        assert(self.app:legacy_snapshot(self.source_id,records,value.captured_at), "legacy snapshot unavailable")
    end)
end

function Entry:baselineAnnotations()
    if not self.app or not self.adapter or type(self.adapter.annotations)~="function" then return end
    self:call(function()
        if type(self.app.annotation_baseline_ready)=="function" and self.app:annotation_baseline_ready(self.source_id) then return end
        local ticket=self.app:begin_annotation_reset(self.source_id)
        local value=self.adapter:annotations(self.ui)
        assert(type(value)=="table" and value.verified==true and value.complete==true and value.source_id==self.source_id, "annotations unavailable")
        assert(self.app:annotation_reset_baseline(self.source_id,ticket,value.records), "annotation baseline unavailable")
    end)
end

function Entry:baselineVocabulary()
    if not self.app or not self.adapter or type(self.adapter.vocabulary)~="function" then return end
    self:call(function()
        local value=self.adapter:vocabulary()
        assert(type(value)=="table" and value.verified==true and type(value.read)=="function", "vocabulary unavailable")
        local ticket=self.app:begin_vocabulary_reset()
        assert(self.app:vocabulary_reset_baseline(ticket,value.read(),value.captured_at), "vocabulary baseline unavailable")
    end)
end
function Entry:vocabulary_ack(bytes)
    if not self.app or not self.source_reset then return false end
    local ok,accepted=pcall(self.app.vocabulary_reset_ack,self.app,bytes)
    return ok and accepted==true
end
function Entry:refreshVocabulary()
    if not self.app or not self.adapter or type(self.adapter.vocabulary)~="function" then return end
    self:call(function()
        local value=self.adapter:vocabulary()
        assert(type(value)=="table" and value.verified==true and type(value.read)=="function", "vocabulary unavailable")
        if self.source_reset then
            local ticket=self.app:begin_vocabulary_read()
            assert(self.app:vocabulary_reset_snapshot(ticket,value.read(),value.captured_at), "vocabulary unavailable")
        else
            assert(self.app:vocabulary_snapshot(value.read,value.captured_at), "vocabulary unavailable")
        end
    end)
end

-- Full vocabulary and statistics reads run on the UI thread right before sleep.
-- Snapshots are complete, so skipping one close to the previous refresh loses
-- nothing: the next refresh reads everything again.
local REFRESH_INTERVAL = 30
function Entry:refreshSnapshots()
    local now = (self.clock or os.time)()
    if type(self.last_refresh) == "number" and now >= self.last_refresh and now - self.last_refresh < REFRESH_INTERVAL then return end
    self:refreshVocabulary(); self:refreshLegacy()
    self.last_refresh = now
end

function Entry:onSuspend()
    if self.sync then self.sync:suspend() end
    if self.runtime and not self.app then self.runtime:cancel_source() end
    if self.app and self.adapter and self.source_ready and not self.closed and not self.suspended then
        if not self:finishPage(false) then self.suspended=true; return end
        self:lifecycle("close")
    end
    if self.source_ready and not self.closed then self:refreshSnapshots() end
    self.suspended=true
end

function Entry:onResume()
    local was_suspended=self.suspended
    if was_suspended and self.pending_page and not self:finishPage(false) then return end
    self.suspended=false
    if was_suspended and self.sync then self.sync:resume() end
    if was_suspended and not self.closed then
        if self.runtime and not self.app then self:onReaderReady()
        elseif self.source_ready then self:lifecycle("open") end
    end
end

-- KOReader emits EndOfBook when the reader reaches the end of the document
-- (event name and timing are upstream assumptions, unverified on the device).
-- The lifecycle store ignores repeats, so a book is finished once per cycle.
-- Records one lifecycle event; returns true when it changed state, false when the
-- store ignored it, nil when capture could not record it.
function Entry:recordLifecycle(event,method,apply)
    if not self.app or not self.adapter or not self.source_ready or self.closed or self.suspended
        or type(self.adapter.lifecycle)~="function" or type(self.app[method])~="function" then return nil end
    local changed
    local ok=self:call(function()
        local value=self.adapter:lifecycle(self.ui,event)
        assert(type(value)=="table" and value.verified==true and value.source_id==self.source_id
            and type(value.uuid)=="function", "lifecycle unavailable")
        changed=apply(value)
    end)
    if not ok then return nil end
    return changed and true or false
end
function Entry:finishBook()
    return self:recordLifecycle("finish","finish_book",function(value) return self.app:finish_book(value.captured_at,value.uuid,true) end)
end
-- Re-reads have no automatic signal; the owner starts a new cycle from the menu.
function Entry:startNewCycle()
    return self:recordLifecycle("cycle","begin_cycle",function(value) return self.app:begin_cycle(value.captured_at,value.uuid,true) end)
end
function Entry:onEndOfBook() self:finishBook() end

function Entry:abandonPending()
    if not self.pending_page or not self.adapter or type(self.adapter.abandon_page)~="function" then return false end
    local ok,result=pcall(self.adapter.abandon_page,self.adapter,self.pending_page)
    if not ok or result~=true then return false end
    self.pending_page=nil; self.pending_is_latest=false; self.capture_gap=true
    return true
end

-- The reader can be torn down without a document close; never leave the timer running.
function Entry:onCloseWidget()
    if self.sync then pcall(function() self.sync:close() end); self.sync=nil end
end

function Entry:onCloseDocument()
    if self.suspended and self.pending_page and not self:finishPage(false) and not self:abandonPending() then return end
    if self.app and self.adapter and self.source_ready and not self.suspended and not self.closed then
        if not self:finishPage(false) and not self:abandonPending() then return end
        self:lifecycle("close")
    end
    if self.source_ready and not self.suspended and not self.closed then self:refreshSnapshots() end
    -- Last bounded delivery attempt while the capture state is still open. An
    -- acknowledgement applied now must not reopen a session or start a page.
    if self.sync and not self.suspended and not self.closed then
        self.closing=true
        pcall(function() self.sync:flush() end)
    end
    self.closed=true
    if self.runtime then
        local ok=pcall(function() self.runtime:close() end)
        self.runtime=nil; self.app=nil; self.adapter=nil; self.source_ready=false
        if not ok then self.status="capture_unavailable" end
    end
    if self.sync then pcall(function() self.sync:close() end); self.sync=nil end
end

return Entry
