-- KOReader v2026.07.1 uses lua-ljsqlite3 and a settings directory. The actual
-- device binding, durability and permissions have not been tested.
local M = {}
function M.open(storage, sqlite)
    storage = storage or require("datastorage")
    sqlite = sqlite or require("lua-ljsqlite3/init")
    local directory = storage:getSettingsDir()
    assert(type(directory) == "string" and directory ~= "", "private state directory unavailable")
    local conn = assert(sqlite.open(directory .. "/kindle-sync.sqlite3"), "private SQLite unavailable")
    local db = {}
    local function execute(sql, args, read)
        local stmt = conn:prepare(sql)
        local ok, result = pcall(function()
            for i, value in ipairs(args or {}) do
                if i == 2 and (sql == "INSERT INTO outbox (seq, packet) VALUES (?, ?)"
                    or sql == "INSERT OR REPLACE INTO capture_state (key, value) VALUES (?, ?)") then
                    assert(type(value) == "string" and type(sqlite.blob) == "function", "SQLite blob support unavailable")
                    value = sqlite.blob(value)
                end
                stmt:bind1(i, value)
            end
            local row = stmt:step()
            if read then
                if not row then return nil end
                assert(not stmt:step(), "unexpected multiple rows")
                return row[1]
            end
            assert(not row, "unexpected SQLite result")
        end)
        local closed = pcall(function() stmt:close() end)
        if not ok or not closed then error("private SQLite statement failed", 0) end
        return result
    end
    function db:exec(sql, args) return execute(sql, args, false) end
    function db:one(sql, args) return execute(sql, args, true) end
    function db:close() conn:close() end
    return db
end
return M
