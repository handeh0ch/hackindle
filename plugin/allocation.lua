local M = {}
local MAX = 9007199254740991
local function integer(n)
    return type(n) == "number" and n >= 0 and n <= MAX and n == math.floor(n)
end
local function valid_date(date)
    if type(date) ~= "string" then return false end
    local y, m, d = date:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
    if not y then return false end
    y, m, d = tonumber(y), tonumber(m), tonumber(d)
    if y == 0 or m < 1 or m > 12 or d < 1 then return false end
    local days = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
    if y % 4 == 0 and (y % 100 ~= 0 or y % 400 == 0) then days[2] = 29 end
    return d <= days[m]
end
-- Each limb stays exactly representable in a Lua number. This permits the
-- sum of up to 366 individually safe weights to exceed 2^53 without rounding.
local BASE=67108864
local function pair(n) local hi=math.floor(n/BASE); return {hi=hi,lo=n-hi*BASE} end
local function less(a,b) return a.hi<b.hi or (a.hi==b.hi and a.lo<b.lo) end
local function add(a,b)
    local low=a.lo+b.lo; local carry=low>=BASE and 1 or 0
    return {hi=a.hi+b.hi+carry,lo=low-carry*BASE}
end
local function sub(a,b)
    local low=a.lo-b.lo; local borrow=low<0 and 1 or 0
    return {hi=a.hi-b.hi-borrow,lo=low+borrow*BASE}
end
local function addmod(a,b,total)
    local sum=add(a,b)
    if not less(sum,total) then return sub(sum,total),1 end
    return sum,0
end
local function muldiv(seconds, weight, total)
    local bits={}
    while seconds>0 do
        local half=math.floor(seconds/2); bits[#bits+1]=seconds-half*2; seconds=half
    end
    local q,r=0,{hi=0,lo=0}
    local w=pair(weight)
    for i=#bits,1,-1 do
        local carry; r,carry=addmod(r,r,total); q=q*2+carry
        if bits[i]==1 then r,carry=addmod(r,w,total); q=q+carry end
    end
    return q,r
end
function M.weights(seconds, weights)
    assert(integer(seconds), "invalid native seconds")
    assert(type(weights) == "table" and #weights > 0 and #weights <= 366, "weights unavailable")
    local total, previous = {hi=0,lo=0}, nil
    for _, item in ipairs(weights) do
        assert(valid_date(item.date)
            and (not previous or previous < item.date), "invalid reporting date")
        assert(integer(item.weight) and item.weight > 0, "invalid weight")
        total, previous = add(total,pair(item.weight)), item.date
    end
    local result, rank, used = {}, {}, 0
    for i, item in ipairs(weights) do
        local amount, remainder = muldiv(seconds, item.weight, total)
        result[i] = {date = item.date, seconds = amount}
        rank[i] = {index = i, remainder = remainder}
        used = used + amount
    end
    table.sort(rank, function(a, b)
        if a.remainder.hi == b.remainder.hi and a.remainder.lo == b.remainder.lo then return a.index < b.index end
        return less(b.remainder,a.remainder)
    end)
    for i = 1, seconds - used do
        local index = rank[i].index
        result[index].seconds = result[index].seconds + 1
    end
    return result
end
-- split(profile, windows) must validate sorted, disjoint UTC windows and return
-- positive integral common-unit durations per local date, including DST splits.
-- Each date weight must be an exact integer no greater than 2^53-1.
function M.windows(seconds, profile, windows, split)
    assert(type(split) == "function" and type(windows) == "table" and #windows > 0,
        "observed windows unavailable")
    local weights = split(profile, windows)
    return M.weights(seconds, weights)
end
-- date_at must return the anchor instant's local date in the saved profile.
function M.anchor(seconds, profile, instant, date_at)
    assert(type(date_at) == "function", "timezone adapter unavailable")
    local date = date_at(profile, instant)
    return M.weights(seconds, {{date = date, weight = 1}})
end
return M
