local identity=require("identity")
local M={}
local MAX=9007199254740991
local function integer(value,min)
    return type(value)=="number" and value>=min and value<=MAX and value==math.floor(value)
end

-- KOReader's LJSQLite3 supports "ro", which refuses to create a missing DB.
-- Availability and WAL behavior on the installed device remain unverified.
function M.open(storage,sqlite)
    storage=storage or require("datastorage")
    sqlite=sqlite or require("lua-ljsqlite3/init")
    local directory=storage:getSettingsDir()
    assert(type(directory)=="string" and directory~="", "native statistics unavailable")
    return assert(sqlite.open(directory.."/statistics.sqlite3","ro"), "native statistics unavailable")
end

-- Read only from a caller-supplied read-only native connection. The binding
-- must independently prove that native_book_id belongs to this exact SHA-256
-- source; KOReader's partial MD5 or book title is not such proof. The result
-- is a complete approximate archive, never primary reading credit.
function M.legacy(conn,binding,date_at)
    assert(type(conn)=="table" and type(binding)=="table" and binding.verified==true and binding.readonly==true
        and integer(binding.native_book_id,1) and type(date_at)=="function", "native statistics unavailable")
    identity.source(binding.source_id)
    local stmt=conn:prepare("SELECT page, start_time, duration, total_pages FROM page_stat_data WHERE id_book = ? ORDER BY start_time, page")
    local ok,result=pcall(function()
        stmt:bind1(1,binding.native_book_id)
        local dates={}
        while true do
            local row,err=stmt:step(); if not row then assert(err==nil, "native statistics read failed"); break end
            local page,start,duration,total=row[1],row[2],row[3],row[4]
            assert(integer(page,1) and integer(start,0) and integer(duration,0) and integer(total,1) and page<=total, "invalid native statistics")
            local instant=os.date("!%Y-%m-%dT%H:%M:%SZ",start)
            assert(type(instant)=="string" and pcall(require("utc").due,instant,nil,false), "native timestamp unavailable")
            local date=date_at(instant)
            assert(type(date)=="string" and #date==10 and pcall(require("utc").due,date.."T00:00:00Z",nil,false), "reporting date unavailable")
            local item=dates[date] or {date=date,native_pages=0,native_seconds=0,seen={}}
            local key=string.format("%.0f:%.0f",page,total)
            if not item.seen[key] then item.seen[key]=true; item.native_pages=item.native_pages+1 end
            assert(item.native_seconds<=MAX-duration and item.native_pages<=MAX, "native statistics overflow")
            item.native_seconds=item.native_seconds+duration; dates[date]=item
        end
        local keys={}; for date in pairs(dates) do keys[#keys+1]=date end; table.sort(keys)
        local records={}
        for _,date in ipairs(keys) do local item=dates[date]; item.seen=nil; records[#records+1]=item end
        return records
    end)
    local closed=pcall(function() stmt:close() end)
    if not ok or not closed then error("native statistics unavailable",0) end
    return result
end
return M
