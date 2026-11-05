local state=require("state")
local identity=require("identity")
local M={}
local has_logger,logger=pcall(require,"logger")
local function warn(...)
    if has_logger and type(logger)=="table" and type(logger.warn)=="function" then pcall(logger.warn,"KindleSync:",...) end
end

local function valid_uuid(value)
    return type(value)=="string" and value:match("^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$")
end

-- Authentication is provided by the future transport; absent evidence no
-- state database is opened and no identity is generated.
function M.open(config,deps)
    assert(type(deps)=="table" and type(deps.authenticated_profile)=="function"
        and deps.authenticated_profile(config)==true, "authenticated profile unavailable")
    assert(type(deps.zoneinfo)=="table", "timezone data unavailable")
    local db=deps.db or require("koreader_sqlite").open()
    local owned=deps.db==nil
    local ok,result=pcall(function()
        local store=state.open(db)
        local device_id=store:get("device_id")
        if not device_id then
            assert(not store:get("seq"), "device identity recovery required")
            device_id=(deps.uuid or require("koreader_entropy").uuid)()
            assert(valid_uuid(device_id), "secure device identity unavailable")
            store:transaction(function(tx) assert(not tx:get("device_id") and not tx:get("seq"), "device identity changed"); tx:put("device_id",device_id) end)
        end
        assert(valid_uuid(device_id), "device identity invalid")
        local app=require("app").open(db,nil,config,device_id,deps.validate_packet,deps.zoneinfo,deps.authenticated_ack)
        return {app=app,db=db,owned=owned,deps=deps,generation=config.reset_generation,serial=0}
    end)
    if not ok then if owned then pcall(function() db:close() end) end; error("plugin initialization unavailable",0) end
    local runtime=result
    function runtime:has_gap()
        return state.open(self.db):get("native_gap_count")~=nil
    end
    function runtime:record_gap()
        local store=state.open(self.db)
        return store:transaction(function(tx) return state.next_counter(tx,"native_gap_count") end)
    end
    function runtime:cancel_source()
        self.serial=self.serial+1
        if self.job then pcall(function() self.job:cancel() end); self.job=nil end
    end
    function runtime:start_source(ui,callback)
        self:cancel_source()
        local serial=self.serial
        local success,job,path,expected_format=pcall(function()
            assert(type(ui)=="table" and type(ui.document)=="table" and type(ui.document.file)=="string", "document unavailable")
            assert(type(deps.resolve_format)=="function", "document format unavailable")
            local format=deps.resolve_format(ui)
            assert(type(format)=="table" and format.verified==true and (format.format=="epub" or format.format=="mobi" or format.format=="pdf"), "document format unavailable")
            local begin=deps.begin_file or require("koreader_hash").begin_file
            return begin(ui.document.file,format.format,{format_verified=true}),ui.document.file,format.format
        end)
        if not success then warn("source could not be opened:",job); callback(nil,"source_unavailable"); return end
        -- Capture the document identity independently of later UI mutations.
        self.job=job
        local function next_step()
            if serial~=runtime.serial then return end
            local ran,value=pcall(function() return job:step(32768) end)
            if not ran or value==nil or type(ui.document)~="table" or ui.document.file~=path then
                if not ran then warn("source hashing failed:",value) end
                runtime:cancel_source(); callback(nil,"source_unavailable"); return
            end
            if value==false then
                local scheduled=pcall(function() (deps.schedule or function(fn) require("ui/uimanager"):nextTick(fn) end)(next_step) end)
                if not scheduled then runtime:cancel_source(); callback(nil,"source_unavailable") end
                return
            end
            local valid=pcall(function() assert(type(value)=="table" and value.verified==true and value.format==expected_format and type(value.unchanged)=="function" and value.unchanged()); identity.source(value.source_id) end)
            if not valid then runtime:cancel_source(); callback(nil,"source_unavailable"); return end
            runtime.job=nil; runtime.serial=runtime.serial+1
            local metadata=require("koreader_metadata").new(function(current)
                assert(current==path, "document changed")
                return {verified=true,source_id=value.source_id,format=value.format,reset=runtime.generation>0}
            end,deps.utc_now or function() return os.date("!%Y-%m-%dT%H:%M:%SZ") end)
            local native=deps.native or {}
            local function guard(reader)
                assert(type(reader)=="table" and type(reader.document)=="table" and reader.document.file==path
                    and value.unchanged()==true, "source changed")
            end
            local adapter={source=function(_,reader) guard(reader); return metadata:source(reader) end}
            for _,method in ipairs({"begin_page","finish_page","discard_page","annotations","lifecycle"}) do
                if type(native[method])=="function" then adapter[method]=function(_,reader,...) guard(reader); return native[method](native,reader,...) end end
            end
            if type(native.commit_page)=="function" then adapter.commit_page=function(_,token) return native:commit_page(token) end end
            if type(deps.reading_baseline)=="function" then
                function adapter:reading_baseline(reader) guard(reader); return deps.reading_baseline(reader,value.source_id,value.format) end
            end
            if not adapter.begin_page and not adapter.finish_page and not adapter.discard_page then
                local timing_binding
                if type(deps.legacy_binding)=="function" then
                    local ok,binding=pcall(deps.legacy_binding,ui,value.source_id)
                    if ok and type(binding)=="table" then timing_binding=binding end
                end
                local acquired,reading=pcall(require("koreader_reading").new,runtime.db,runtime.app,value.source_id,
                    deps.uuid or require("koreader_entropy").uuid,deps.utc_now or function() return os.date("!%Y-%m-%dT%H:%M:%SZ") end,timing_binding,value.format,runtime.generation)
                if not acquired then callback(nil,"source_unavailable"); return end
                local recovered,gap=pcall(reading.recover,reading)
                if not recovered then reading:close(); callback(nil,"source_unavailable"); return end
                runtime.reading=reading; adapter.recovered_gap=gap
                for _,method in ipairs({"begin_page","finish_page","discard_page"}) do
                    adapter[method]=function(_,reader,...) guard(reader); return reading[method](reading,reader,...) end
                end
                function adapter:commit_page(token) return reading:commit_page(token) end
                function adapter:abandon_page(token) return reading:abandon_page(token) end
            end
            if not adapter.lifecycle then
                function adapter:lifecycle(reader,event)
                    guard(reader)
                    local now=(deps.utc_now or function() return os.date("!%Y-%m-%dT%H:%M:%SZ") end)()
                    local function uuid()
                        local next_id=(deps.uuid or require("koreader_entropy").uuid)()
                        assert(valid_uuid(next_id), "secure identity unavailable")
                        return next_id
                    end
                    return {verified=true,source_id=value.source_id,cycle_id=event=="open" and uuid() or nil,captured_at=now,uuid=uuid}
                end
            end
            if not adapter.annotations and type(deps.annotation_binding)=="function" then
                function adapter:annotations(reader,change)
                    guard(reader)
                    local binding=deps.annotation_binding(reader,value.source_id,value.format)
                    assert(type(binding)=="table" and binding.source_id==value.source_id and binding.format==value.format, "native annotation source mismatch")
                    local function uuid()
                        local next_id=(deps.uuid or require("koreader_entropy").uuid)()
                        assert(valid_uuid(next_id), "secure identity unavailable")
                        return next_id
                    end
                    local now=(deps.utc_now or function() return os.date("!%Y-%m-%dT%H:%M:%SZ") end)()
                    local snapshot=require("koreader_annotations").snapshot(reader,binding,uuid,now,change)
                    snapshot.reset=runtime.generation>0
                    return snapshot
                end
            end
            do
                function adapter:vocabulary()
                    local now=(deps.utc_now or function() return os.date("!%Y-%m-%dT%H:%M:%SZ") end)()
                    return {verified=true,captured_at=now,read=function()
                        local connection=type(deps.vocabulary_connection)=="function" and deps.vocabulary_connection()
                            or require("koreader_vocabulary").open()
                        local ok,words=pcall(require("koreader_vocabulary").read,connection)
                        local closed=pcall(function() connection:close() end)
                        assert(ok and closed, "native vocabulary unavailable")
                        return words
                    end}
                end
            end
            if type(deps.legacy_binding)=="function" then
                function adapter:legacy(reader)
                    guard(reader)
                    local binding=deps.legacy_binding(reader,value.source_id)
                    assert(type(binding)=="table" and binding.source_id==value.source_id, "native statistics source mismatch")
                    local now=(deps.utc_now or function() return os.date("!%Y-%m-%dT%H:%M:%SZ") end)()
                    local owned=type(deps.legacy_connection)~="function"
                    local connection=owned and require("koreader_statistics").open() or deps.legacy_connection(reader)
                    return {verified=true,source_id=value.source_id,connection=connection,binding=binding,captured_at=now,owned=owned,
                        uuid=deps.uuid or require("koreader_entropy").uuid}
                end
            end
            callback(adapter)
        end
        local scheduled=pcall(function() (deps.schedule or function(fn) require("ui/uimanager"):nextTick(fn) end)(next_step) end)
        if not scheduled then self:cancel_source(); callback(nil,"source_unavailable") end
    end
    function runtime:close()
        self:cancel_source()
        if self.reading then self.reading:close(); self.reading=nil end
        if self.owned then self.db:close(); self.owned=false end
    end
    return runtime
end
return M
