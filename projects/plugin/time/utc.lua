local M = {}
local function parse(value)
    assert(type(value) == "string", "invalid progress instant")
    local y, mo, d, h, mi, s, frac = value:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)[Tt ](%d%d):(%d%d):(%d%d)(.-)Z$")
    assert(y, "invalid progress instant")
    y, mo, d, h, mi, s = tonumber(y), tonumber(mo), tonumber(d), tonumber(h), tonumber(mi), tonumber(s)
    assert(y > 0 and mo >= 1 and mo <= 12 and h < 24 and mi < 60 and s < 60, "invalid progress instant")
    local days={31,28,31,30,31,30,31,31,30,31,30,31}
    local leap=y%4==0 and (y%100~=0 or y%400==0)
    if leap then days[2]=29 end
    assert(d >= 1 and d <= days[mo], "invalid progress instant")
    if frac ~= "" then
        assert(frac:match("^%.%d+$") and #frac <= 10, "invalid progress instant")
        frac=frac:sub(2)
    end
    frac = (frac .. "000000000"):sub(1,9)
    local prior=y-1
    local count=prior*365+math.floor(prior/4)-math.floor(prior/100)+math.floor(prior/400)
    for i=1,mo-1 do count=count+days[i] end
    return ((count+d-1)*24+h)*3600+mi*60+s, frac
end
function M.parts(value) return parse(value) end
function M.due(value, previous, boundary)
    local current, fraction=parse(value)
    if previous == nil then return true end
    local before, before_fraction=parse(previous)
    local diff=current-before
    if boundary then return true end
    assert(diff > 0 or (diff == 0 and fraction >= before_fraction), "progress clock regressed; lifecycle boundary required")
    return diff > 60 or (diff == 60 and fraction >= before_fraction)
end
return M
