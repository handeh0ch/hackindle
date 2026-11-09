local ffi = require("ffi")
ffi.cdef[[
typedef struct sqlite3 sqlite3;
typedef struct sqlite3_stmt sqlite3_stmt;
int sqlite3_open_v2(const char *, sqlite3 **, int, const char *);
int sqlite3_close(sqlite3 *);
int sqlite3_prepare_v2(sqlite3 *, const char *, int, sqlite3_stmt **, const char **);
int sqlite3_bind_text(sqlite3_stmt *, int, const char *, int, void (*)(void *));
int sqlite3_bind_int64(sqlite3_stmt *, int, long long);
int sqlite3_step(sqlite3_stmt *);
int sqlite3_finalize(sqlite3_stmt *);
const void *sqlite3_column_blob(sqlite3_stmt *, int);
int sqlite3_column_bytes(sqlite3_stmt *, int);
]]
local M = {}
local transient = ffi.cast("void (*)(void *)", -1)
function M.open(path, library)
    local c = library or ffi.load("sqlite3")
    local handle = ffi.new("sqlite3 *[1]")
    local rc = c.sqlite3_open_v2(path, handle, 6, nil)
    if rc ~= 0 then
        if handle[0] ~= nil then c.sqlite3_close(handle[0]) end
        error("SQLite open failed: " .. rc)
    end
    local db = {}
    local function execute(sql, args, read)
        local statement = ffi.new("sqlite3_stmt *[1]")
        local code = c.sqlite3_prepare_v2(handle[0], sql, -1, statement, nil)
        if code ~= 0 then error("SQLite prepare failed: " .. code) end
        local ok, result = pcall(function()
            for i, value in ipairs(args or {}) do
                local bind
                if type(value) == "string" then
                    bind = c.sqlite3_bind_text(statement[0], i, value, #value, transient)
                else
                    assert(type(value) == "number" and value == math.floor(value), "invalid SQLite argument")
                    bind = c.sqlite3_bind_int64(statement[0], i, value)
                end
                if bind ~= 0 then error("SQLite bind failed: " .. bind) end
            end
            code = c.sqlite3_step(statement[0])
            if read and code == 100 then
                local n = c.sqlite3_column_bytes(statement[0], 0)
                if n == 0 then return "" end
                return ffi.string(c.sqlite3_column_blob(statement[0], 0), n)
            end
            if code ~= 101 then error("SQLite step failed: " .. code) end
        end)
        local finalized = c.sqlite3_finalize(statement[0])
        if not ok then error(result, 0) end
        if finalized ~= 0 then error("SQLite finalize failed: " .. finalized) end
        return result
    end
    function db:exec(sql, args) return execute(sql, args, false) end
    function db:one(sql, args) return execute(sql, args, true) end
    function db:close()
        local code = c.sqlite3_close(handle[0])
        if code ~= 0 then error("SQLite close failed: " .. code) end
        handle[0] = nil
    end
    return db
end
return M
