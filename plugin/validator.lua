local codec = require("codec")
local json = require("wire_json")
local utc = require("utc")
local M = {}
local null = json.null
local MAX = 9007199254740991
local function require_(v) assert(v, "invalid envelope") end
local function object(v, required, optional)
    require_(type(v) == "table" and v ~= null and not json.is_array(v))
    local allowed = {}
    for _, key in ipairs(required) do allowed[key]=true; require_(v[key] ~= nil) end
    for _, key in ipairs(optional or {}) do allowed[key]=true end
    for key in pairs(v) do require_(allowed[key]) end
end
local function array(v) require_(json.is_array(v)) end
local function string_(v) require_(type(v) == "string") end
local function nonempty(v) string_(v); require_(#v > 0) end
local function nullable_string(v) if v ~= null then string_(v) end end
local function integer(v, min) require_(type(v) == "number" and v >= min and v <= MAX and v == math.floor(v)) end
local function uuid(v)
    string_(v)
    local x=v:lower():gsub("^urn:uuid:", "")
    require_(#x == 36 and x:match("^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$"))
end
local function hash(v) string_(v); require_(#v == 64 and v:match("^[0-9a-f]+$")) end
local function instant(v) require_(pcall(utc.due,v,nil,false)) end
local function locator(v)
    if type(v) == "table" and v.type == "xpointer" then
        object(v,{"type","value"}); nonempty(v.value)
    else
        object(v,{"type","page","boxes","geometry_version"}); require_(v.type == "pdf"); integer(v.page,1); array(v.boxes)
        for _, box in ipairs(v.boxes) do
            object(box,{"x","y","width","height"})
            for _, k in ipairs({"x","y","width","height"}) do require_(type(box[k]) == "number") end
            require_(box.width > 0 and box.height > 0)
        end
        if #v.boxes == 0 then require_(v.geometry_version == null) else nonempty(v.geometry_version) end
    end
    return v.type
end
local function progress(v)
    object(v,{"fraction","position","observed_at","session_id"})
    require_(type(v.fraction) == "number" and v.fraction >= 0 and v.fraction <= 1)
    locator(v.position); instant(v.observed_at); uuid(v.session_id)
end
local function metadata(v)
    object(v,{"format","title","authors","language","identifiers"})
    require_(v.format == "epub" or v.format == "mobi" or v.format == "pdf")
    string_(v.title); nullable_string(v.language); array(v.authors); array(v.identifiers)
    for _, author in ipairs(v.authors) do string_(author) end
    for _, id in ipairs(v.identifiers) do
        object(id,{"scheme","value","provenance"}); string_(id.scheme); string_(id.value); string_(id.provenance)
    end
end
local function section(v, check)
    object(v,{"version","value"}); integer(v.version,1); check(v.value)
end
local function date(v) string_(v); require_(#v == 10); instant(v .. "T00:00:00Z") end
local function nullable_integer(v) if v ~= null then integer(v,0) end end
local function nullable_nonempty(v) if v ~= null then nonempty(v) end end
local function timestamp_key(v)
    instant(v)
    local base=v:sub(1,19):upper():gsub(" ","T")
    local fraction=v:match("%.(%d+)Z$") or ""
    return base .. (fraction .. "000000000"):sub(1,9)
end
local function segment(v, types)
    object(v,{"event_id","source_id","session_id","occurred_at","type","native_seconds","native_record_id",
        "measurement_version","provenance","timing_quality","allocation","credited_characters","ranges",
        "awake_windows","native_anchor","volume_quality","volume_date"})
    nullable_integer(v.native_seconds); nullable_nonempty(v.native_record_id); nonempty(v.measurement_version); nullable_nonempty(v.provenance)
    nullable_integer(v.credited_characters); if v.volume_date ~= null then date(v.volume_date) end
    require_(v.volume_quality == "measured" or v.volume_quality == "unavailable")
    array(v.ranges); local chars=0
    for _, r in ipairs(v.ranges) do
        object(r,{"start","end","characters"}); local a,b=locator(r.start),locator(r["end"])
        require_(a == b); types[a]=true
        if a == "pdf" then require_(#r.start.boxes > 0 and #r["end"].boxes > 0) end
        integer(r.characters,0); require_(r.characters <= MAX-chars); chars=chars+r.characters
    end
    if v.volume_quality == "unavailable" then
        require_(v.credited_characters == null and v.volume_date == null and #v.ranges == 0)
    else
        require_(v.credited_characters ~= null and v.volume_date ~= null and chars == v.credited_characters)
        require_(v.credited_characters ~= 0 or #v.ranges == 0)
    end
    array(v.allocation); require_(#v.allocation <= 366)
    local seconds, previous=0,nil
    for _, a in ipairs(v.allocation) do
        object(a,{"date","seconds"}); date(a.date); integer(a.seconds,0)
        require_(not previous or previous < a.date); previous=a.date
        require_(a.seconds <= MAX-seconds); seconds=seconds+a.seconds
    end
    array(v.awake_windows)
    local last
    for _, w in ipairs(v.awake_windows) do
        object(w,{"start","end"})
        local a,b=timestamp_key(w.start),timestamp_key(w["end"])
        require_(a < b and (not last or last <= a)); last=b
    end
    if v.native_anchor ~= null then instant(v.native_anchor) end
    if v.timing_quality == "unavailable" then
        require_(v.native_seconds == null and #v.allocation == 0 and #v.awake_windows == 0 and v.native_anchor == null)
    else
        require_(v.native_record_id ~= null and v.provenance ~= null and v.native_seconds ~= null and #v.allocation > 0 and seconds == v.native_seconds)
        if v.timing_quality == "estimated_native_anchor" then require_(v.native_anchor ~= null and #v.awake_windows == 0)
        else require_(v.timing_quality == "observed_windows" and v.native_anchor == null and #v.awake_windows > 0) end
    end
end
local function annotation(v, types)
    object(v,{"annotation_id","kind","start","end","quote","note","chapter","native_timestamp","context"})
    uuid(v.annotation_id); require_(v.kind == "highlight" or v.kind == "bookmark")
    string_(v.quote); string_(v.note); nullable_string(v.chapter); nullable_string(v.native_timestamp)
    local kind=locator(v.start); types[kind]=true
    if v["end"] ~= null then require_(locator(v["end"]) == kind) end
    if v.kind == "highlight" and kind == "pdf" then
        require_(#v.start.boxes > 0 and v["end"] ~= null and #v["end"].boxes > 0 and v.start.page <= v["end"].page)
    end
    local c=v.context
    if v.kind == "bookmark" then require_(c == null); return end
    require_(c ~= null and type(c) == "table")
    if c.status == "pending" or c.status == "unavailable" then
        object(c,{"status","reason"}); nonempty(c.reason); return
    end
    object(c,{"status","origin","captured_at","page_basis","total_pages","before","selection_pages","after"})
    require_(c.status == "ready" and (c.origin == "creation" or c.origin == "backfill"))
    require_(c.page_basis == "rendered" or c.page_basis == "original_pdf")
    require_((kind == "pdf") == (c.page_basis == "original_pdf"))
    instant(c.captured_at); integer(c.total_pages,1); array(c.selection_pages); require_(#c.selection_pages > 0)
    local pages={}
    local function page(p)
        object(p,{"number","text"}); integer(p.number,1); string_(p.text)
        require_(p.number <= c.total_pages and (#pages == 0 or p.number == pages[#pages] + 1))
        pages[#pages+1]=p.number
    end
    if c.before ~= null then page(c.before) end
    for _, p in ipairs(c.selection_pages) do page(p) end
    if c.after ~= null then page(c.after) end
    require_(c.before ~= null or pages[1] == 1)
    require_(c.after ~= null or pages[#pages] == c.total_pages)
    if kind == "pdf" then
        require_(v["end"] ~= null and c.selection_pages[1].number == v.start.page
            and c.selection_pages[#c.selection_pages].number == v["end"].page)
    end
end
local function events(payload, source, types)
    object(payload,{"events"}); array(payload.events); require_(#payload.events > 0)
    local ids={}
    for _, event in ipairs(payload.events) do
        require_(type(event) == "table" and event ~= null)
        if event.type == "reading_segment" then segment(event,types)
        elseif event.type == "progress_sample" then
            object(event,{"event_id","source_id","session_id","occurred_at","type","progress"})
            progress(event.progress); types[event.progress.position.type]=true
        else
            object(event,{"event_id","source_id","session_id","occurred_at","type","cycle_id"})
            require_(event.type == "session_started" or event.type == "session_ended" or event.type == "cycle_started" or event.type == "book_finished")
            uuid(event.cycle_id)
        end
        uuid(event.event_id); uuid(event.session_id); instant(event.occurred_at); require_(event.source_id == source)
        local id=event.event_id:lower(); require_(not ids[id]); ids[id]=true
    end
end
local function validate(v)
    object(v,{"schema_version","instance_id","device_id","reset_generation","seq","captured_at","kind","source_id","payload"})
    require_(v.schema_version == 1); uuid(v.instance_id); uuid(v.device_id); integer(v.reset_generation,0); integer(v.seq,1); instant(v.captured_at)
    if v.kind == "vocabulary_snapshot" then require_(v.source_id == null) else hash(v.source_id) end
    local types={}
    if v.kind == "source_snapshot" then
        object(v.payload,{}, {"metadata","progress","annotations"})
        require_(v.payload.metadata ~= nil or v.payload.progress ~= nil or v.payload.annotations ~= nil)
        if v.payload.metadata ~= nil then section(v.payload.metadata,metadata) end
        if v.payload.progress ~= nil then section(v.payload.progress,progress); types[v.payload.progress.value.position.type]=true end
        if v.payload.annotations ~= nil then
            local ids={}
            section(v.payload.annotations,function(list)
                array(list)
                for _, item in ipairs(list) do
                    annotation(item,types)
                    local id=item.annotation_id:lower(); require_(not ids[id]); ids[id]=true
                end
            end)
        end
    elseif v.kind == "reading_events" then events(v.payload,v.source_id,types)
    elseif v.kind == "vocabulary_snapshot" then
        object(v.payload,{"version","words"},{"unicode_version"}); integer(v.payload.version,1); array(v.payload.words)
        if v.payload.unicode_version~=nil then string_(v.payload.unicode_version); require_(v.payload.unicode_version:match("^%d+%.%d+$")) end
        for _, word in ipairs(v.payload.words) do
            object(word,{"word","language","source"}); string_(word.word); nullable_string(word.language); nullable_string(word.source)
        end
    elseif v.kind == "legacy_statistics" then
        object(v.payload,{"version","records"},{"mode","baseline_id","native_epoch"}); integer(v.payload.version,1); array(v.payload.records)
        if v.payload.mode ~= nil or v.payload.baseline_id ~= nil or v.payload.native_epoch ~= nil then
            require_(v.payload.mode == "baseline" or v.payload.mode == "snapshot")
            uuid(v.payload.baseline_id); uuid(v.payload.native_epoch)
        end
        local seen={}
        for _, record in ipairs(v.payload.records) do
            object(record,{"date","native_pages","native_seconds"}); date(record.date)
            integer(record.native_pages,0); integer(record.native_seconds,0)
            require_(not seen[record.date]); seen[record.date]=true
        end
    else error("unsupported envelope kind") end
    require_(not (types.xpointer and types.pdf))
end
function M.validate(bytes)
    if type(bytes) ~= "string" or #bytes > 16777216 then return false end
    local ok = pcall(function() validate(codec.decode(bytes)) end)
    return ok
end
return M
