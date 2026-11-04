package.path = "plugin/?.lua;" .. package.path
local tz = require("tzif")
local function u32(n) return string.char(math.floor(n/16777216)%256,math.floor(n/65536)%256,math.floor(n/256)%256,n%256) end
local function header(count) return "TZif2"..string.rep("\0",15)..u32(0)..u32(0)..u32(0)..u32(count)..u32(2)..u32(8) end
local transitions={1704067200,1710054000,1730613600,1767225600}
local indices=string.char(0,1,0,0)
local types=u32(4294949296)..string.char(0,0)..u32(4294952896)..string.char(1,4)
local names="EST\0EDT\0"
local v1=header(0)..types..names
local times={}; for _,v in ipairs(transitions) do times[#times+1]=u32(0)..u32(v) end
local bytes=v1..header(#transitions)..table.concat(times)..indices..types..names.."\nEST5EDT,M3.2.0,M11.1.0\n"
local provider=function(name) assert(name=="Synthetic/Eastern"); return bytes end
local zone=tz.load("Synthetic/Eastern",provider)
assert(zone:date_at("2024-03-10T04:59:59Z") == "2024-03-09")
assert(zone:date_at("2024-03-10T05:00:00Z") == "2024-03-10")
local weights=zone:split({{start="2024-03-09T05:00:00Z",["end"]="2024-03-11T04:00:00Z"}})
assert(#weights==2 and weights[1].date=="2024-03-09" and weights[1].weight==86400)
assert(weights[2].date=="2024-03-10" and weights[2].weight==82800)
weights=zone:split({{start="2024-03-10T04:59:59.999999999Z",["end"]="2024-03-10T05:00:00.000000001Z"}})
assert(#weights==2 and weights[1].weight==1 and weights[2].weight==1)
assert(zone:date_at("2027-07-01T04:30:00Z") == "2027-07-01")
assert(zone:date_at("2027-01-01T04:30:00Z") == "2026-12-31")
assert(not pcall(function() tz.load("../secret",provider) end))
assert(not pcall(function() tz.load("Synthetic/Eastern",function() return "bad" end) end))
print("TZif assertions passed")
local bridge=tz.adapter("Synthetic/Eastern",provider)
local profile={reporting_timezone="Synthetic/Eastern"}
local event={occurred_at="2024-03-10T05:00:00Z",timing_quality="observed_windows",native_seconds=2,
    awake_windows={{start="2024-03-10T04:59:59.999999999Z",["end"]="2024-03-10T05:00:00.000000001Z"}},
    allocation={{date="2024-03-09",seconds=1},{date="2024-03-10",seconds=1}}}
assert(bridge.verify_reporting(event,profile))
event.allocation[1].seconds=2; event.allocation[2].seconds=0
assert(not bridge.verify_reporting(event,profile))
assert(not bridge.verify_reporting(event,{reporting_timezone="Other/Zone"}))
weights=zone:split({{start="2024-11-03T04:00:00Z",["end"]="2024-11-04T05:00:00Z"}})
assert(#weights==1 and weights[1].date=="2024-11-03" and weights[1].weight==90000)
assert(not pcall(function() zone:date_at("2023-12-31T23:59:59Z") end))
local long=zone:split({{start="2024-01-02T00:00:00Z",["end"]="2024-05-01T00:00:00Z"}})
assert(#long == 121 and long[1].weight == 18000)
assert(not pcall(function() zone:split({{start="2024-03-10T05:00:01Z",["end"]="2024-03-10T05:00:00Z"}}) end))
assert(not pcall(function() zone:split({{start="2024-03-10T05:00:00Z",["end"]="2024-03-10T05:00:02Z"},{start="2024-03-10T05:00:01Z",["end"]="2024-03-10T05:00:03Z"}}) end))
local a={occurred_at="2024-03-10T05:00:00Z",timing_quality="estimated_native_anchor",native_seconds=0,
    native_anchor="2024-03-10T04:59:59Z",allocation={{date="2024-03-09",seconds=0}}}
assert(bridge.verify_reporting(a,profile))
a.allocation[1].date="2024-03-10"; assert(not bridge.verify_reporting(a,profile))
local malformed = v1..header(#transitions)..table.concat(times)..indices..types.."ESTXEDTX".."\nEST5EDT,M3.2.0,M11.1.0\n"
assert(not pcall(function() tz.load("Synthetic/Eastern",function() return malformed end) end))
local full_year=zone:split({{start="2024-01-01T05:00:00Z",["end"]="2025-01-01T05:00:00Z"}})
assert(#full_year==366 and full_year[1].date=="2024-01-01" and full_year[366].date=="2024-12-31")
local fixedtypes=u32(18000)..string.char(0,0)..u32(18000)..string.char(0,4)
local fixedbytes=v1..header(0)..fixedtypes..names.."\n<+05>-5\n"
local fixed=tz.load("Etc/GMT-5",function() return fixedbytes end)
assert(fixed:date_at("2024-01-01T20:00:00Z")=="2024-01-02")
local fractional_year=zone:split({{start="2024-01-02T05:00:00.000000001Z",["end"]="2025-01-01T05:00:00.000000001Z"}})
assert(#fractional_year==366 and fractional_year[1].weight==86400*1000000000-1 and fractional_year[366].weight==1)
local south_types=u32(36000)..string.char(0,0)..u32(39600)..string.char(1,4)
local south_times={1704067200,1712419200,1728144000,1767225600}
local south_raw={}; for _,v in ipairs(south_times) do south_raw[#south_raw+1]=u32(0)..u32(v) end
local south=v1..header(4)..table.concat(south_raw)..string.char(1,0,1,1)..south_types..names.."\nAEST-10AEDT,M10.1.0,M4.1.0/3\n"
local southern=tz.load("Synthetic/Southern",function() return south end)
assert(southern:date_at("2027-01-01T13:30:00Z")=="2027-01-02")
assert(southern:date_at("2027-07-01T13:30:00Z")=="2027-07-01")
local future=zone:split({{start="2027-03-14T04:59:59Z",["end"]="2027-03-14T05:00:01Z"}})
assert(#future==2 and future[1].date=="2027-03-13" and future[2].date=="2027-03-14")
local unsupported=bytes:gsub("M3%.2%.0,M11%.1%.0", "J60,J300")
local limited=tz.load("Synthetic/Eastern",function() return unsupported end)
assert(not pcall(function() limited:date_at("2030-01-01T00:00:00Z") end))
local calls=0
local provider_for_root=tz.provider("/synthetic/zoneinfo",function(path,limit)
    calls=calls+1; assert(path=="/synthetic/zoneinfo/Synthetic/Eastern" and limit==1048576); return bytes
end)
assert(tz.load("Synthetic/Eastern",provider_for_root):date_at("2024-03-10T05:00:00Z")=="2024-03-10")
assert(not pcall(function() provider_for_root("../outside") end) and calls==1)
assert(not pcall(function() tz.provider("/synthetic/../outside",function() end) end))
assert(not pcall(function() tz.provider("relative/path",function() end) end))
return bytes
