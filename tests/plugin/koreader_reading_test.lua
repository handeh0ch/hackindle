package.path="plugin/?.lua;"..package.path
local provider=require("koreader_reading")
local codec=require("codec")
local rows={}; local db={}
function db:exec(sql,args) if sql:match("INSERT OR REPLACE") then rows[args[1]]=args[2] end end
function db:one(sql,args) return rows[args[1]] end
local source=("a"):rep(64); local id="10000000-0000-4000-8000-000000000001"
local app={reading_context=function() return {session_id=id,day="2026-01-01"} end,reading_native_seen=function() return false end}
local document={getPageCount=function() return 3 end,getPageXPointer=function(_,n) return tostring(n) end,
    getXPointer=function() return "here" end,compareXPointers=function(_,a,b) return tonumber(b)-tonumber(a) end,
    getTextFromXPointers=function() return "abc" end}
local ui={document=document,highlight={}}
local r=provider.new(db,app,source,function() return id end,function() return "2026-01-01T00:00:00Z" end)
assert(not pcall(function() provider.new(db,app,source,function() return id end,function() return "2026-01-01T00:00:00Z" end) end))
assert(not pcall(function() provider.new(db,app,("b"):rep(64),function() return id end,function() return "time" end) end))
local t=r:begin_page(ui,1); assert(t.durable and t.verified and codec.decode(rows.native_page).event_id==id)
local v=r:finish_page(ui,t,2); assert(v.sample.seconds==nil and v.sample.first=="1" and v.sample.last=="2" and v.sample.session_id==id and v.adapter.measure("1","2")==3)
assert(r:commit_page(t) and rows.native_page=="")
local other=r:begin_page(ui,2); assert(r:discard_page(ui,other) and rows.native_page=="")
local stale=r:begin_page(ui,1); assert(r:recover() and rows.native_page=="" and rows["native_gap:"..stale.event_id] and rows.native_gap_count=="1")
assert(not r:recover())
ui.highlight.hold_pos={}; local bad=r:begin_page(ui,1); assert(not pcall(function() r:finish_page(ui,bad,2).adapter.measure("1","2") end)); r:discard_page(ui,bad)
local last=r:begin_page(ui,3); assert(last.first=="3" and last.last=="4"); assert(r:discard_page(ui,last))
document.getPageXPointer=function(_,n) if n<=3 then return tostring(n) end end
assert(not pcall(function() r:begin_page(ui,3) end))
r:close()
local stats={document=document,is_doc=true,id_curr_book=7,curr_page=1,page_stat={[1]={{1767225600,0}}}}
ui.statistics=stats; ui.highlight.hold_pos=nil
document.getPageXPointer=function(_,n) return tostring(n) end
local timed=provider.new(db,app,source,function() return id end,function() return "2026-01-01T00:00:00Z" end,{verified=true,source_id=source,native_book_id=7,epoch_verified=true,epoch=id})
local measured=timed:begin_page(ui,1); stats.page_stat[1][1][2]=12
local sample=timed:finish_page(ui,measured,2).sample
assert(sample.seconds==12 and sample.timing.quality=="estimated_native_anchor" and sample.timing.from==0 and sample.timing.to==12)
assert(sample.provenance=="koreader_statistics" and sample.native_id)
timed:discard_page(ui,measured); timed:close()
local pdf=provider.new(db,app,source,function() return id end,function() return "2026-01-01T00:00:00Z" end,{verified=true,source_id=source,native_book_id=7,epoch_verified=true,epoch=id},"pdf")
stats.page_stat[1][1][2]=0
local pdf_token=pdf:begin_page(ui,1); stats.page_stat[1][1][2]=6
local pdf_sample=pdf:finish_page(ui,pdf_token,2).sample
assert(pdf_sample.first==nil and pdf_sample.last==nil and pdf_sample.seconds==6)
pdf:discard_page(ui,pdf_token)
stats.page_stat[1]={{1767225600,0},{1767225600,0}}
local ambiguous=pdf:begin_page(ui,1); stats.page_stat[1][1][2]=9
assert(pdf:finish_page(ui,ambiguous,2).sample.seconds==nil); pdf:discard_page(ui,ambiguous)
stats.page_stat[1]={[2]={1767225600,0}}
local sparse=pdf:begin_page(ui,1); assert(pdf:finish_page(ui,sparse,2).sample.seconds==nil); pdf:discard_page(ui,sparse)
stats.page_stat[1]={{1767225600,0}}
local seen=pdf:begin_page(ui,1); stats.page_stat[1][1][2]=7
app.reading_native_seen=function() return true end
assert(pdf:finish_page(ui,seen,2).sample.seconds==nil); pdf:discard_page(ui,seen)
app.reading_native_seen=function() return false end
pdf:close()
local blocked=provider.new(db,app,source,function() return id end,function() return "2026-01-01T00:00:00Z" end,nil,"pdf",1)
assert(not pcall(function() blocked:begin_page(ui,1) end)); blocked:close()
local reset=provider.new(db,app,source,function() return id end,function() return "2026-01-01T00:00:00Z" end,{verified=true,source_id=source,native_book_id=7,epoch_verified=true,epoch=id},"pdf",1)
local reset_token=reset:begin_page(ui,1); local reset_sample=reset:finish_page(ui,reset_token,2).sample
assert(reset_sample.reset_verified and reset_sample.native_epoch==id); reset:discard_page(ui,reset_token); reset:close()
local again=provider.new(db,app,source,function() return id end,function() return "time" end); again:close()
print("KOReader reading adapter assertions passed")
