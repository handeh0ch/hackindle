-- TZif v2/v3 transition-table subset. POSIX recurring footers and leap
-- seconds are not interpreted; instants outside explicit coverage fail closed.
local utc = require("utc")
local M = {}
local MAX = 9007199254740991
local UNIX = 62135596800
local function u32(s,p)
    local a,b,c,d=s:byte(p,p+3); assert(d,"truncated TZif")
    return ((a*256+b)*256+c)*256+d
end
local function signed32(x) return x >= 2147483648 and x-4294967296 or x end
local function i64(s,p)
    local high=signed32(u32(s,p)); local low=u32(s,p+4)
    local n=high*4294967296+low
    assert(n >= -MAX and n <= MAX,"TZif instant out of range")
    return n
end
local function header(s,p)
    assert(s:sub(p,p+3) == "TZif" and (s:sub(p+4,p+4) == "2" or s:sub(p+4,p+4) == "3"),"unsupported TZif")
    assert(s:sub(p+5,p+19) == string.rep("\0",15),"invalid TZif header")
    local h={ut=u32(s,p+20),std=u32(s,p+24),leap=u32(s,p+28),time=u32(s,p+32),types=u32(s,p+36),chars=u32(s,p+40)}
    assert(h.leap == 0 and h.time <= 4096 and h.types >= 1 and h.types <= 256 and h.chars >= 1 and h.chars <= 65536,"unsupported TZif counts")
    assert((h.ut == 0 or h.ut == h.types) and (h.std == 0 or h.std == h.types),"invalid TZif indicators")
    return h
end
local function block_size(h,size)
    return h.time*size+h.time+h.types*6+h.chars+h.leap*(size+4)+h.std+h.ut
end
local function instant(value)
    local sec,frac=utc.parts(value)
    return sec-UNIX,tonumber(frac)
end
local function date_for_day(day)
    local absolute=day+719162
    assert(absolute >= 0 and absolute <= 3652058,"reporting date out of range")
    local lo,hi=1,10000
    local function first(y) local p=y-1; return p*365+math.floor(p/4)-math.floor(p/100)+math.floor(p/400) end
    while lo+1<hi do local mid=math.floor((lo+hi)/2); if first(mid)<=absolute then lo=mid else hi=mid end end
    local y=lo; local n=absolute-first(y); local m=1
    local days={31,28,31,30,31,30,31,31,30,31,30,31}
    if y%4==0 and (y%100~=0 or y%400==0) then days[2]=29 end
    while n>=days[m] do n=n-days[m]; m=m+1 end
    return string.format("%04d-%02d-%02d",y,m,n+1)
end
-- Accept only fixed-offset POSIX footers; seasonal recurrence is unsupported.
local function fixed_offset(footer)
    local text=footer:sub(2,-2)
    local name,offset=text:match("^<([%w%+%-]+)>(.+)$")
    if not name then name,offset=text:match("^(%a+)(.+)$") end
    if not name or #name<3 then return nil end
    local sign,body=offset:match("^([%+%-]?)(.+)$")
    local h,m,s=body:match("^(%d+):(%d%d):(%d%d)$")
    if not h then h,m=body:match("^(%d+):(%d%d)$"); s="0" end
    if not h then h=body:match("^(%d+)$"); m,s="0","0" end
    if not h then return nil end
    h,m,s=tonumber(h),tonumber(m),tonumber(s)
    if h>24 or m>59 or s>59 or (h==24 and (m~=0 or s~=0)) then return nil end
    local amount=h*3600+m*60+s
    return sign=="-" and amount or -amount
end
-- Supports the common POSIX Mmonth.week.weekday recurrence; other rule forms
-- remain unavailable rather than extrapolating an incorrect zone.
local function recurring_rules(footer)
    local text=footer:sub(2,-2)
    local function name_prefix(s)
        local name,rest=s:match("^<([%w%+%-]+)>(.*)$")
        if not name then name,rest=s:match("^(%a+)(.*)$") end
        if not name or #name<3 then return nil end
        return name,rest
    end
    local _,rest=name_prefix(text)
    if not rest then return nil end
    local raw; raw,rest=rest:match("^([%+%-]?%d+[:%d]*)(.*)$")
    if not raw then return nil end
    local standard=fixed_offset("\nAAA"..raw.."\n")
    if standard==nil then return nil end
    local dstname; dstname,rest=name_prefix(rest)
    if not dstname then return nil end
    local daylight=standard+3600
    if rest:sub(1,1)~="," then
        raw,rest=rest:match("^([%+%-]?%d+[:%d]*)(.*)$")
        if not raw then return nil end
        daylight=fixed_offset("\nAAA"..raw.."\n")
        if daylight==nil then return nil end
    end
    local start_rule,end_rule=rest:match("^,([^,]+),([^,]+)$")
    if not start_rule then return nil end
    local function rule(s)
        local m,w,d,extra=s:match("^M(%d+)%.(%d+)%.(%d+)(.*)$")
        if not m then return nil end
        m,w,d=tonumber(m),tonumber(w),tonumber(d)
        if m<1 or m>12 or w<1 or w>5 or d>6 then return nil end
        local when=7200
        if extra~="" then
            local sign,body=extra:match("^/([%+%-]?)(.+)$")
            if not body then return nil end
            local h,mi,se=body:match("^(%d+):(%d%d):(%d%d)$")
            if not h then h,mi=body:match("^(%d+):(%d%d)$"); se="0" end
            if not h then h=body:match("^(%d+)$"); mi,se="0","0" end
            if not h then return nil end
            h,mi,se=tonumber(h),tonumber(mi),tonumber(se)
            if h>167 or mi>59 or se>59 then return nil end
            when=(h*3600+mi*60+se)*(sign=="-" and -1 or 1)
        end
        return {month=m,week=w,weekday=d,seconds=when}
    end
    local start,finish=rule(start_rule),rule(end_rule)
    if not start or not finish then return nil end
    return {standard=standard,daylight=daylight,start=start,finish=finish}
end
local function day_number(year,rule)
    local prior=year-1
    local first=prior*365+math.floor(prior/4)-math.floor(prior/100)+math.floor(prior/400)
    local months={31,28,31,30,31,30,31,31,30,31,30,31}
    if year%4==0 and (year%100~=0 or year%400==0) then months[2]=29 end
    for i=1,rule.month-1 do first=first+months[i] end
    local weekday=(first+1)%7
    local day=1+(rule.weekday-weekday+7)%7+(rule.week-1)*7
    if day>months[rule.month] then day=day-7 end
    return first+day-1-719162
end
local function recurrence_at(rules, second)
    local year=tonumber(date_for_day(math.floor(second/86400)):sub(1,4))
    local candidates={}
    for y=math.max(1,year-1),math.min(9999,year+1) do
        candidates[#candidates+1]={time=day_number(y,rules.start)*86400+rules.start.seconds-rules.standard,offset=rules.daylight}
        candidates[#candidates+1]={time=day_number(y,rules.finish)*86400+rules.finish.seconds-rules.daylight,offset=rules.standard}
    end
    table.sort(candidates,function(a,b) return a.time<b.time end)
    local prior,next_time
    for i,item in ipairs(candidates) do
        assert(i==1 or candidates[i-1].time~=item.time,"ambiguous timezone recurrence")
        if item.time<=second then prior=item.offset elseif not next_time then next_time=item.time end
    end
    assert(prior and next_time,"timezone recurrence out of range")
    return prior,next_time
end
local function valid_zone(name)
    return type(name)=="string" and #name>0 and #name<=255 and name:match("^[%w_+%-%/]+$")
        and name:sub(1,1)~="/" and name:sub(-1)~="/" and not name:find("//",1,true)
end
-- read_file(path, limit) must perform a read-only bounded read under a trusted
-- zoneinfo tree. The caller is responsible for restricting symlink targets.
function M.provider(root, read_file)
    assert(type(root)=="string" and root:sub(1,1)=="/" and not root:find("\0",1,true)
        and not root:find("//",1,true) and type(read_file)=="function","invalid zoneinfo provider")
    for part in root:gmatch("[^/]+") do assert(part~="." and part~="..","invalid zoneinfo root") end
    root=root:gsub("/+$", "")
    return function(name)
        assert(valid_zone(name),"invalid timezone")
        local bytes=read_file(root.."/"..name,1048576)
        assert(type(bytes)=="string" and #bytes<=1048576,"timezone data unavailable")
        return bytes
    end
end
function M.load(name, provider)
    assert(valid_zone(name),"invalid timezone")
    assert(type(provider)=="function","timezone data unavailable")
    local data=provider(name)
    assert(type(data)=="string" and #data<=1048576,"timezone data unavailable")
    local first=header(data,1)
    local second_pos=45+block_size(first,4)
    local h=header(data,second_pos)
    local start=second_pos+44; local finish=start+block_size(h,8)-1
    assert(finish <= #data,"truncated TZif")
    local transitions={}
    for i=1,h.time do
        local time=i64(data,start+(i-1)*8)
        assert(i==1 or transitions[i-1].time < time,"invalid TZif transitions")
        transitions[i]={time=time,index=data:byte(start+h.time*8+i-1)}
        assert(transitions[i].index and transitions[i].index < h.types,"invalid TZif transition type")
    end
    local typepos=start+h.time*9; local types={}
    local namepos=typepos+h.types*6
    for i=1,h.types do
        local p=typepos+(i-1)*6; local offset=signed32(u32(data,p)); local dst,abbr=data:byte(p+4,p+5)
        assert(offset >= -89999 and offset <= 93599 and (dst==0 or dst==1) and abbr and abbr<h.chars,"invalid TZif type")
        local zero=data:find("\0",namepos+abbr,true)
        assert(zero and zero < namepos+h.chars,"invalid TZif designation")
        types[i]=offset
    end
    local indicators=namepos+h.chars
    for i=1,h.types do
        local standard=h.std==0 and 0 or data:byte(indicators+i-1)
        local universal=h.ut==0 and 0 or data:byte(indicators+h.std+i-1)
        assert((standard==0 or standard==1) and (universal==0 or universal==1)
            and (universal==0 or standard==1),"invalid TZif indicators")
    end
    local footer=data:sub(finish+1)
    assert(footer:match("^\n[^\n]*\n$") and not footer:find("\0",1,true),"invalid TZif footer")
    local fixed=fixed_offset(footer)
    local rules=not fixed and recurring_rules(footer) or nil
    if h.time==0 and fixed ~= nil then assert(types[1]==fixed,"TZif fixed offset mismatch") end
    assert(h.time >= 2 or fixed ~= nil or rules,"TZif coverage unavailable")
    if h.time>0 and (fixed ~= nil or rules) then
        local last=transitions[#transitions]
        local ending=fixed
        if rules then ending=recurrence_at(rules,last.time) end
        assert(ending==types[last.index+1],"TZif footer conflicts with transitions")
    end
    local function offset_at(second)
        if h.time==0 then
            if fixed ~= nil then return fixed,nil end
            return recurrence_at(rules,second)
        end
        assert(second >= transitions[1].time,"timezone transition coverage unavailable")
        if second >= transitions[#transitions].time then
            if fixed ~= nil then return fixed,nil end
            assert(rules,"timezone transition coverage unavailable")
            return recurrence_at(rules,second)
        end
        local lo,hi=1,#transitions
        while lo+1<hi do local mid=math.floor((lo+hi)/2); if transitions[mid].time<=second then lo=mid else hi=mid end end
        return types[transitions[lo].index+1],transitions[lo+1].time
    end
    local zone={}
    function zone:date_at(value)
        local second=instant(value); local offset=offset_at(second)
        return date_for_day(math.floor((second+offset)/86400))
    end
    function zone:split(windows)
        assert(type(windows)=="table" and #windows>0,"windows unavailable")
        local weights,lasts,lastn={},nil,nil
        local parsed, precision = {}, 0
        local function digits(n)
            if n==0 then return 0 end
            local value=string.format("%09d",n):gsub("0+$", "")
            return #value
        end
        for _,window in ipairs(windows) do
            local s,n=instant(window.start); local e,en=instant(window["end"])
            precision=math.max(precision,digits(n),digits(en))
            parsed[#parsed+1]={s=s,n=n,e=e,en=en}
        end
        local scale=10^precision
        local divisor=10^(9-precision)
        for _,window in ipairs(parsed) do
            local s,n,e,en=window.s,window.n/divisor,window.e,window.en/divisor
            assert(s<e or (s==e and n<en),"invalid window")
            assert(not lasts or s>lasts or (s==lasts and n>=lastn),"overlapping windows")
            lasts,lastn=e,en
            while s<e or (s==e and n<en) do
                local offset,next_transition=offset_at(s)
                local day=math.floor((s+offset)/86400); local date=date_for_day(day)
                local edge=(day+1)*86400-offset
                if next_transition and next_transition<edge then edge=next_transition end
                local finish_sec,finish_ns=edge,0
                if e<edge or (e==edge and en==0) then finish_sec,finish_ns=e,en end
                local weight=(finish_sec-s)*scale+finish_ns-n
                assert(weight>0 and weight<=MAX-(weights[date] or 0),"timezone duration exceeds precision limit")
                weights[date]=(weights[date] or 0)+weight
                s,n=finish_sec,finish_ns
            end
        end
        local dates={}; for d in pairs(weights) do dates[#dates+1]=d end; table.sort(dates)
        assert(#dates<=366,"too many reporting dates")
        local result={}; for _,d in ipairs(dates) do result[#result+1]={date=d,weight=weights[d]} end
        return result
    end
    return zone
end
-- This adapter independently reprojects the emitted event before enqueue.
function M.adapter(name, provider)
    local zone=M.load(name,provider)
    local allocation=require("allocation")
    local adapter={}
    local function policy(profile) assert(type(profile)=="table" and profile.reporting_timezone==name,"reporting timezone mismatch") end
    function adapter.date_at(profile,value) policy(profile); return zone:date_at(value) end
    function adapter.split(profile,windows) policy(profile); return zone:split(windows) end
    function adapter.verify_reporting(event,profile)
        local ok=pcall(function()
            policy(profile); zone:date_at(event.occurred_at)
            if event.timing_quality=="unavailable" then return end
            local expected
            if event.timing_quality=="estimated_native_anchor" then
                expected=allocation.anchor(event.native_seconds,profile,event.native_anchor,adapter.date_at)
            else
                assert(event.timing_quality=="observed_windows","unsupported timing quality")
                expected=allocation.windows(event.native_seconds,profile,event.awake_windows,adapter.split)
            end
            assert(type(event.allocation)=="table" and #event.allocation==#expected,"allocation mismatch")
            for i,item in ipairs(expected) do
                assert(event.allocation[i].date==item.date and event.allocation[i].seconds==item.seconds,"allocation mismatch")
            end
        end)
        return ok
    end
    return adapter
end
return M
