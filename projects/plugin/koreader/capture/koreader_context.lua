local M={}
local function pending() return {status="pending",reason="page extraction unavailable"} end
-- CRE methods and one-based rendered page boundaries follow upstream source;
-- their installed-device behavior and selection signals remain unverified.
function M.capture(ui,record,captured_at,origin)
    local ok,result=pcall(function()
        assert(type(ui)=="table" and type(ui.document)=="table" and type(ui.highlight)=="table")
        local doc,highlight=ui.document,ui.highlight
        local function safe() return highlight.hold_pos==nil and highlight.selected_text==nil end
        assert(safe())
        local total=doc:getPageCount(true)
        local first=doc:getPageFromXPointer(record.start.value)
        local last=doc:getPageFromXPointer(record["end"].value)
        assert(type(total)=="number" and type(first)=="number" and type(last)=="number"
            and total==math.floor(total) and first==math.floor(first) and last==math.floor(last)
            and first>=1 and first<=last and last<=total)
        local position=doc:getXPointer(); assert(type(position)=="string" and position~="")
        local function extract(page)
            assert(safe() and page<=total)
            local a,b=doc:getPageXPointer(page),doc:getPageXPointer(page+1)
            assert(type(a)=="string" and a~="" and type(b)=="string" and b~="" and a~=b and doc:compareXPointers(a,b)==1)
            local text=doc:getTextFromXPointers(a,b)
            assert(type(text)=="string" and safe() and doc:getXPointer()==position)
            return text
        end
        return require("snapshots.context").capture(extract,total,first,last,"rendered",origin or "backfill",captured_at,require("protocol.wire_json").null)
    end)
    return ok and result or pending()
end
return M
