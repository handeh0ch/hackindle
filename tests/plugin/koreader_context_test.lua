package.path="projects/plugin/?.lua;"..package.path
local native=require("koreader.capture.koreader_context")
local json=require("protocol.wire_json")
local calls=0
local doc={compareXPointers=function(_,a,b) return tonumber(b)>tonumber(a) and 1 or -1 end,getPageCount=function() return 4 end,getPageFromXPointer=function(_,p) return tonumber(p) end,
    getPageXPointer=function(_,p) if p<=5 then return tostring(p) end end,
    getXPointer=function() return "current" end,getTextFromXPointers=function(_,a,b) calls=calls+1; return "page "..a end}
local ui={document=doc,highlight={}}
local value=native.capture(ui,{start={value="2"},["end"]={value="2"}},"2026-01-01T00:00:00Z","creation")
assert(value.status=="ready" and value.origin=="creation" and value.before.text=="page 1" and value.after.text=="page 3" and value.selection_pages[1].text=="page 2")
ui.highlight.hold_pos={}; local n=calls; assert(native.capture(ui,{start={value="2"},["end"]={value="2"}},"time").status=="pending" and calls==n)
ui.highlight.hold_pos=nil
assert(native.capture(ui,{start={value="4"},["end"]={value="4"}},"time").status=="ready")
assert(native.capture(ui,{start={value="3"},["end"]={value="3"}},"time").status=="ready")
doc.getPageXPointer=function(_,p) if p<=4 then return tostring(p) end end
assert(native.capture(ui,{start={value="4"},["end"]={value="4"}},"time").status=="pending")
doc.getXPointer=function() calls=calls+1; return tostring(calls) end
assert(native.capture(ui,{start={value="2"},["end"]={value="2"}},"time").status=="pending")
assert(native.capture({}, {}, "time").status=="pending")
print("KOReader context adapter assertions passed")
