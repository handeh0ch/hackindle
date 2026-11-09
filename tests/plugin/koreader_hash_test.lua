package.path = "projects/plugin/?.lua;" .. package.path
local hash = require("koreader.device.koreader_hash")
local fed={}
local digest=("a"):rep(64)
local sha={sha256=function() return function(part)
    if part == nil then return digest end
    fed[#fed+1]=part
end end}
local chunks={"abc","def"}; local i=0
assert(hash.stream(function() i=i+1; return chunks[i] end,sha) == digest)
assert(table.concat(fed)=="abcdef")
assert(not pcall(function() hash.stream(function() return nil,"read error" end,sha) end))
assert(not pcall(function() hash.stream(function() return "" end,sha) end))
assert(not pcall(function() hash.stream(function() return nil end,{sha256=function() return function() return "bad" end end}) end))
print("KOReader hashing adapter assertions passed")

local attrs={mode="file",dev=1,ino=2,size=6,modification=3,change=4}
local data="abcdef"
local closed=0
local function fake_open(path,mode)
    assert(path=="/synthetic/book" and mode=="rb")
    local position=1
    return {read=function(_,n) if position>#data then return nil end; local part=data:sub(position,position+n-1); position=position+#part; return part end,
        seek=function(_,whence,offset) assert(whence=="set" and offset==0); position=1; return 0 end,
        close=function() closed=closed+1; return true end}
end
local fake_sha={sha256=function()
    local bytes=""
    return function(chunk) if chunk then bytes=bytes..chunk else return bytes=="abcdef" and ("a"):rep(64) or ("b"):rep(64) end end
end}
local opts={stat=function() return attrs end,open=fake_open,sha2=fake_sha,format_verified=true}
local job=hash.begin_file("/synthetic/book","epub",opts)
local result
repeat result=job:step(2) until result~=false
assert(result.verified and result.source_id==("a"):rep(64) and result.format=="epub" and closed==1)
assert(result.unchanged())
attrs.modification=9; assert(not result.unchanged()); attrs.modification=3
assert(not pcall(function() job:step(2) end))
local unstable=hash.begin_file("/synthetic/book","epub",opts)
assert(unstable:step(2)==false); attrs.modification=9
local bad,reason=unstable:step(2); assert(bad==nil and reason=="source_unavailable" and closed==2)
attrs.modification=3
local changed=hash.begin_file("/synthetic/book","epub",opts)
for _=1,4 do assert(changed:step(2)==false) end
data="abcdeg"
local final,err
repeat final,err=changed:step(2) until final~=false
assert(final==nil and err=="source_unavailable" and closed==3)
assert(not pcall(function() hash.begin_file("/synthetic/book","epub",{stat=opts.stat,open=fake_open,sha2=fake_sha}) end))
data="abcdef"
local canceled=hash.begin_file("/synthetic/book","epub",opts); assert(canceled:cancel() and closed==4)
assert(not pcall(function() canceled:step(2) end))
local opened=false
assert(not pcall(function() hash.begin_file("/synthetic/book","epub",{stat=opts.stat,format_verified=true,open=function(...) opened=true; return fake_open(...) end,sha2={sha256=function() error("unavailable") end}}) end))
assert(not opened)
print("Stable file hashing assertions passed")
