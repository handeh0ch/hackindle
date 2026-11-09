package.path="projects/plugin/?.lua;"..package.path
local metadata=require("koreader.capture.koreader_metadata")
local json=require("protocol.wire_json")
local source=("a"):rep(64)
local ui={document={file="/synthetic/book.epub"},doc_props={display_title="Synthetic",authors="Example Author",language="en"}}
local adapter=metadata.new(function(path) assert(path=="/synthetic/book.epub"); return {source_id=source,format="epub",verified=true} end,
    function() return "2026-01-01T00:00:00Z" end)
local value=adapter:source(ui)
assert(value.verified and value.source_id==source and value.metadata.title=="Synthetic")
assert(value.metadata.authors[1]=="Example Author" and value.metadata.language=="en")
ui.doc_props={display_title="Synthetic"}; value=adapter:source(ui)
assert(#value.metadata.authors==0 and value.metadata.language==json.null)
assert(not pcall(function() metadata.new(function() return {source_id=source,format="epub"} end,function() return "2026-01-01T00:00:00Z" end):source(ui) end))
assert(not pcall(function() metadata.new(function() return {source_id=source,format="azw3",verified=true} end,function() return "2026-01-01T00:00:00Z" end):source(ui) end))
assert(not pcall(function() adapter:source({document={file="/synthetic/book.epub"},doc_props={}}) end))
assert(adapter:begin_page(ui,1)==nil and adapter:finish_page(ui,{},2)==nil and adapter:annotations(ui,{})==nil)
print("KOReader metadata adapter assertions passed")
