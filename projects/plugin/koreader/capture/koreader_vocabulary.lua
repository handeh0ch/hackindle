local json=require("protocol.wire_json")
local M={}
-- KOReader's vocabulary table has no language or dictionary source column.
function M.open(storage,sqlite)
    storage=storage or require("datastorage")
    sqlite=sqlite or require("lua-ljsqlite3/init")
    local directory=storage:getSettingsDir()
    assert(type(directory)=="string" and directory~="", "native vocabulary unavailable")
    return assert(sqlite.open(directory.."/vocabulary_builder.sqlite3","ro"), "native vocabulary unavailable")
end
function M.read(conn)
    local stmt=conn:prepare("SELECT word FROM vocabulary ORDER BY word")
    local ok,words=pcall(function()
        local result=json.array({})
        while true do
            local row,err=stmt:step()
            if not row then assert(err==nil, "native vocabulary read failed"); break end
            assert(type(row[1])=="string", "invalid native vocabulary")
            result[#result+1]={word=row[1],language=json.null,source=json.null}
        end
        return result
    end)
    local closed=pcall(function() stmt:close() end)
    if not ok or not closed then error("native vocabulary unavailable",0) end
    return words
end
return M
