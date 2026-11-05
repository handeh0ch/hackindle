local state=require("state")
local codec=require("codec")
local M={}
local function matching(rows,start,zero_only)
    local count=0
    for key in pairs(rows) do if type(key)~="number" or key<1 or key~=math.floor(key) then return nil end; count=count+1 end
    local found,matches=nil,0
    for i=1,count do
        local row=rows[i]
        if type(row)~="table" then return nil end
        if row[1]==start and (not zero_only or row[2]==0) then found=row; matches=matches+1 end
    end
    return matches==1 and found or nil
end
local function valid_binding(binding,source)
    return type(binding)=="table" and binding.verified==true and binding.epoch_verified==true and binding.source_id==source
        and type(binding.epoch)=="string" and binding.epoch:match("^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$")
        and type(binding.native_book_id)=="number" and binding.native_book_id>=1
        and binding.native_book_id<=9007199254740991 and binding.native_book_id==math.floor(binding.native_book_id)
end
local active
-- CRE position/page numbering and selection signals are device assumptions.
-- Native seconds are unavailable here; no wall-clock time is credited.
function M.new(db,app,source,uuid,now,binding,format,generation)
    local store=state.open(db)
    assert(not active, "reading source already active")
    local p={}
    active=p
    function p:close() if active==self then active=nil end end
    function p:begin_page(ui,page)
        local doc=ui.document
        local total=doc:getPageCount(true)
        assert(type(total)=="number" and page>=1 and page<=total, "page boundary unavailable")
        local first,last
        if format~="pdf" then
            first,last=doc:getPageXPointer(page),doc:getPageXPointer(page+1)
            assert(type(first)=="string" and first~="" and type(last)=="string" and last~="" and first~=last and doc:compareXPointers(first,last)==1, "page boundary unavailable")
        end
        if generation and generation>0 then
            assert(valid_binding(binding,source), "reading epoch unavailable")
        end
        local at=now(); local context=app:reading_context(source,at)
        local token={verified=true,durable=true,source=source,first=first,last=last,event_id=uuid(),session_id=context.session_id,day=context.day,occurred_at=at}
        if generation and generation>0 then token.native_epoch=binding.epoch; token.reset_verified=true end
        local stats=ui.statistics
        if valid_binding(binding,source) and type(stats)=="table" and stats.document==doc and stats.is_doc and stats.id_curr_book==binding.native_book_id
            and stats.curr_page==page and type(stats.page_stat)=="table" and type(stats.page_stat[page])=="table" then
            local seconds=require("utc").parts(at)-62135596800
            local match=matching(stats.page_stat[page],seconds,false)
            if match and match[2]==0 then token.native_start=seconds; token.native_page=page; token.native_epoch=binding.epoch; token.native_book=binding.native_book_id end
        end
        store:transaction(function(tx) assert(not tx:get("native_page") or tx:get("native_page")=="", "pending page requires reconciliation"); tx:put("native_page",codec.encode(token)) end)
        return token
    end
    local function check(token)
        local encoded=store:get("native_page")
        assert(encoded and encoded~="" and codec.decode(encoded).event_id==token.event_id and token.source==source, "page token unavailable")
    end
    function p:finish_page(ui,token)
        check(token)
        local doc=ui.document
        local adapter={}
        function adapter.compare(a,b)
            local result=doc:compareXPointers(a,b)
            assert(type(result)=="number" and (result==-1 or result==0 or result==1), "locator comparison unavailable")
            return -result
        end
        function adapter.measure(a,b)
            local h=ui.highlight
            assert(type(h)=="table" and h.hold_pos==nil and h.selected_text==nil, "active selection")
            local before=doc:getXPointer(); assert(type(before)=="string" and before~="")
            local text=doc:getTextFromXPointers(a,b)
            assert(type(text)=="string" and doc:getXPointer()==before and h.hold_pos==nil and h.selected_text==nil, "text extraction unavailable")
            return require("reading").count(text)
        end
        function adapter.locator(x) return {type="xpointer",value=x} end
        local sample={source=source,source_id=source,event_id=token.event_id,observation_id=token.event_id,
            session_id=token.session_id,occurred_at=token.occurred_at,day=token.day,
            first=token.first,last=token.last,measurement_version="utf8-scalars-v1",native_epoch=token.native_epoch,reset_verified=token.reset_verified}
        local stats=ui.statistics
        if token.native_start and valid_binding(binding,source) and binding.epoch==token.native_epoch
            and type(stats)=="table" and stats.document==doc and stats.is_doc and stats.id_curr_book==token.native_book
            and type(stats.page_stat)=="table" and type(stats.page_stat[token.native_page])=="table" then
            local row=matching(stats.page_stat[token.native_page],token.native_start,false)
            local duration=row and row[2]
            local native_id=token.native_epoch..":"..token.native_book..":"..token.native_page..":"..token.native_start
            if row and type(duration)=="number" and duration>0 and duration<=9007199254740991 and duration==math.floor(duration)
                and not app:reading_native_seen(source,native_id) then
                sample.native_id=native_id; sample.seconds=duration; sample.provenance="koreader_statistics"
                sample.timing={from=0,to=duration,quality="estimated_native_anchor",anchor=token.occurred_at}
            end
        end
        return {verified=true,captured_at=token.occurred_at,adapter=adapter,sample=sample}
    end
    function p:commit_page(token)
        return store:transaction(function(tx)
            local encoded=tx:get("native_page"); assert(encoded and encoded~="" and codec.decode(encoded).event_id==token.event_id, "page token unavailable")
            tx:put("native_page",""); return true
        end)
    end
    -- A restart may have occurred before rerender invalidation. Preserve an
    -- explicit durable gap instead of crediting an uncertain pending token.
    function p:recover()
        return store:transaction(function(tx)
            local encoded=tx:get("native_page")
            if not encoded or encoded=="" then return false end
            local token=codec.decode(encoded)
            assert(type(token.event_id)=="string" and token.event_id~="", "page token unavailable")
            tx:put("native_gap:"..token.event_id,encoded); state.next_counter(tx,"native_gap_count"); tx:put("native_page",""); return true
        end)
    end
    function p:abandon_page(token)
        check(token)
        return self:recover()
    end
    function p:discard_page(ui,token) return self:commit_page(token) end
    return p
end
return M
