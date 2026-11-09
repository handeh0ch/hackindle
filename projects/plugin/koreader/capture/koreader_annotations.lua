local identity=require("protocol.identity")
local json=require("protocol.wire_json")
local codec=require("protocol.codec")
local M={}

-- KOReader has no native annotation ID. key_for must provide a separately
-- verified durable association; position, quote and timestamp are not IDs.
-- This adapter currently supports complete rolling-text highlight sets only.
function M.snapshot(ui,binding,allocate,captured_at,change)
    assert(type(ui)=="table" and type(ui.annotation)=="table" and type(ui.annotation.annotations)=="table"
        and type(binding)=="table" and binding.verified==true and binding.complete==true
        and (binding.format=="epub" or binding.format=="mobi") and type(binding.key_for)=="function"
        and type(allocate)=="function", "native annotations unavailable")
    identity.source(binding.source_id)
    assert(type(captured_at)=="string" and pcall(require("time.utc").due,captured_at,nil,false), "UTC timestamp unavailable")
    local native=ui.annotation.annotations; local count=0
    for key in pairs(native) do assert(type(key)=="number" and key>=1 and key==math.floor(key), "incomplete native annotations"); count=count+1 end
    for i=1,count do assert(native[i]~=nil, "incomplete native annotations") end
    local records,seen,save={},{},nil
    for index,item in ipairs(native) do
        assert(type(item)=="table" and type(item.pos0)=="string" and item.pos0~=""
            and type(item.pos1)=="string" and item.pos1~="" and type(item.text)=="string"
            and (item.note==nil or type(item.note)=="string") and (item.chapter==nil or type(item.chapter)=="string")
            and (item.datetime==nil or type(item.datetime)=="string"), "unsupported native annotation")
        local association=binding.key_for(item)
        assert(type(association)=="table" and association.verified==true and type(association.key)=="string"
            and association.key~="" and not seen[association.key], "native annotation identity unavailable")
        seen[association.key]=true
        local created=type(change)=="table" and change.nb_highlights_added==1
            and change.index_modified==index and change[1]==item and not change.modify_datetime
        if created then save={key=association.key,event_id=allocate()} end
        records[#records+1]={key=association.key,selection=codec.encode(json.array({item.pos0,item.pos1})),kind="highlight",
            start={type="xpointer",value=item.pos0},["end"]={type="xpointer",value=item.pos1},quote=item.text,
            note=item.note or "",chapter=item.chapter or json.null,native_timestamp=item.datetime or json.null,backfill=not created}
    end
    return {verified=true,complete=true,source_id=binding.source_id,records=records,allocate=allocate,captured_at=captured_at,save=save,
        extract=function(record,origin) return require("koreader.capture.koreader_context").capture(ui,record,captured_at,origin) end}
end
return M
