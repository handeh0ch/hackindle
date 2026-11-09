package.path="projects/plugin/?.lua;"..package.path
local native=require("koreader.capture.koreader_vocabulary")
local json=require("protocol.wire_json")
local opened
local conn=native.open({getSettingsDir=function() return "/settings" end},{open=function(path,mode) opened={path,mode}; return {} end})
assert(conn and opened[1]=="/settings/vocabulary_builder.sqlite3" and opened[2]=="ro")
local rows={{"first"},{"second"}}; local i=0; local closed=false
local db={prepare=function(_,sql)
    assert(sql=="SELECT word FROM vocabulary ORDER BY word")
    return {step=function() i=i+1; return rows[i] end,close=function() closed=true end}
end}
local words=native.read(db); assert(closed and #words==2 and words[1].word=="first" and words[1].language==json.null and words[1].source==json.null)
i=0; rows={{"first"},{false}}; assert(not pcall(native.read,db))
i=0; rows={{"first"}}; db.prepare=function() return {step=function() return nil,"error" end,close=function() end} end
assert(not pcall(native.read,db))
assert(not pcall(native.open,{getSettingsDir=function() return "" end},{}))
print("KOReader vocabulary adapter assertions passed")
