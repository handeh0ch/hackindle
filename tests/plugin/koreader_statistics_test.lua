package.path="plugin/?.lua;"..package.path
local stats=require("koreader_statistics")
local opened
local opened_conn={}
local storage={getSettingsDir=function() return "/synthetic/settings" end}
local sqlite={open=function(path,mode) opened={path,mode}; return opened_conn end}
assert(stats.open(storage,sqlite)==opened_conn and opened[1]=="/synthetic/settings/statistics.sqlite3" and opened[2]=="ro")
assert(not pcall(function() stats.open({getSettingsDir=function() return "" end},sqlite) end))
local rows={{1,1704067200,5,200},{1,1704067205,7,200},{2,1704153600,4,200}}
local closed,bound=0,nil
local conn={}
function conn:prepare(sql)
    assert(sql=="SELECT page, start_time, duration, total_pages FROM page_stat_data WHERE id_book = ? ORDER BY start_time, page")
    local i=0
    return {bind1=function(_,n,value) assert(n==1); bound=value end,
        step=function() i=i+1; return rows[i] end,
        close=function() closed=closed+1 end}
end
local binding={verified=true,readonly=true,source_id=("a"):rep(64),native_book_id=7}
local records=stats.legacy(conn,binding,function(instant) return instant:sub(1,10) end)
assert(bound==7 and closed==1 and #records==2)
assert(records[1].date=="2024-01-01" and records[1].native_pages==1 and records[1].native_seconds==12)
assert(records[2].date=="2024-01-02" and records[2].native_pages==1 and records[2].native_seconds==4)
assert(not pcall(function() stats.legacy(conn,{verified=true,readonly=false,source_id=binding.source_id,native_book_id=7},function() end) end))
rows={{1,1704067200,-1,200}}
assert(not pcall(function() stats.legacy(conn,binding,function(instant) return instant:sub(1,10) end) end) and closed==2)
rows={}
assert(#stats.legacy(conn,binding,function() error("unexpected") end)==0 and closed==3)
local interrupted={prepare=function() return {bind1=function() end,step=function() return nil,"read failed" end,close=function() closed=closed+1 end} end}
assert(not pcall(function() stats.legacy(interrupted,binding,function() return "2024-01-01" end) end) and closed==4)
print("KOReader statistics adapter assertions passed")
