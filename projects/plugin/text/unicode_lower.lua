local data=require("text.unicode_data")
local M={version=data.version}
local function contains(ranges,n)
    local lo,hi=1,#ranges
    while lo<=hi do
        local mid=math.floor((lo+hi)/2); local r=ranges[mid]
        if n<r[1] then hi=mid-1 elseif n>r[2] then lo=mid+1 else return true end
    end
    return false
end
local function utf8(n)
    if n<0x80 then return string.char(n) end
    if n<0x800 then return string.char(0xC0+math.floor(n/64),0x80+n%64) end
    if n<0x10000 then return string.char(0xE0+math.floor(n/4096),0x80+math.floor(n/64)%64,0x80+n%64) end
    return string.char(0xF0+math.floor(n/262144),0x80+math.floor(n/4096)%64,0x80+math.floor(n/64)%64,0x80+n%64)
end
function M.lower(value)
    require("reading.reading").count(value)
    local points,i={},1
    while i<=#value do
        local a=value:byte(i); local n=a<0x80 and 1 or (a<0xE0 and 2 or (a<0xF0 and 3 or 4))
        local cp=n==1 and a or a%(2^(7-n))
        for j=1,n-1 do cp=cp*64+value:byte(i+j)-0x80 end
        points[#points+1]=cp; i=i+n
    end
    local function cased_from(index,step)
        while points[index] do
            local cp=points[index]
            if not contains(data.ignorable,cp) then return contains(data.cased,cp) end
            index=index+step
        end
        return false
    end
    local out={}
    for index,cp in ipairs(points) do
        local lower
        if cp==0x3A3 and cased_from(index-1,-1) and not cased_from(index+1,1) then lower={0x3C2}
        else lower=data.map[cp] or {cp} end
        for _,n in ipairs(lower) do out[#out+1]=utf8(n) end
    end
    return table.concat(out)
end
return M
