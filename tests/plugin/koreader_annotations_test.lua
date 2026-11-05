package.path="plugin/?.lua;"..package.path
local annotations=require("koreader_annotations")
local json=require("wire_json")
local source=("a"):rep(64)
local item={pos0="/a",pos1="/b",text="synthetic",note="note",chapter="Chapter",datetime="2026-01-01 12:00:00"}
local ui={annotation={annotations={item}}}
local binding={verified=true,complete=true,source_id=source,format="epub",key_for=function() return {verified=true,key="stable-native-key"} end}
local value=annotations.snapshot(ui,binding,function() return "id" end,"2026-01-01T00:00:00Z")
assert(value.verified and value.complete and value.source_id==source and #value.records==1)
local record=value.records[1]
assert(record.key=="stable-native-key" and record.start.value=="/a" and record["end"].value=="/b")
assert(record.quote=="synthetic" and record.note=="note" and record.native_timestamp==item.datetime and record.backfill)
assert(value.extract(record,"creation").status=="pending")
local created=annotations.snapshot(ui,binding,function() return "event-id" end,"2026-01-01T00:00:00Z",{item,nb_highlights_added=1,index_modified=1})
assert(created.records[1].backfill==false and created.save.key=="stable-native-key" and created.save.event_id=="event-id")
local extended=annotations.snapshot(ui,binding,function() end,"2026-01-01T00:00:00Z",{item,nb_highlights_added=1,index_modified=1,modify_datetime=true})
assert(extended.records[1].backfill==true and extended.save==nil)
ui.annotation.annotations={}; value=annotations.snapshot(ui,binding,function() end,"2026-01-01T00:00:00Z"); assert(#value.records==0)
ui.annotation.annotations={item,item}; assert(not pcall(function() annotations.snapshot(ui,binding,function() end,"2026-01-01T00:00:00Z") end))
ui.annotation.annotations={[2]=item}; assert(not pcall(function() annotations.snapshot(ui,binding,function() end,"2026-01-01T00:00:00Z") end))
ui.annotation.annotations={item}; local bad={verified=true,complete=true,source_id=source,format="pdf",key_for=binding.key_for}
assert(not pcall(function() annotations.snapshot(ui,bad,function() end,"2026-01-01T00:00:00Z") end))
item.note=nil; item.chapter=nil; item.datetime=nil
record=annotations.snapshot(ui,binding,function() end,"2026-01-01T00:00:00Z").records[1]
assert(record.note=="" and record.chapter==json.null and record.native_timestamp==json.null)
print("KOReader annotation adapter assertions passed")
