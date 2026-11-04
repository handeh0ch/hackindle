package.path = "plugin/?.lua;" .. package.path
local ffi = require("ffi")
local sqlite = require("sqlite")
local fake = {step = 101, binds = {}}
function fake.sqlite3_open_v2(path, ptr) ptr[0] = ffi.cast("sqlite3*", 1); return 0 end
function fake.sqlite3_prepare_v2(db, sql, n, ptr) ptr[0] = ffi.cast("sqlite3_stmt*", 2); return 0 end
function fake.sqlite3_bind_text(stmt, i, value, n) fake.binds[i] = ffi.string(value, n); return 0 end
function fake.sqlite3_bind_int64(stmt, i, value) fake.binds[i] = tonumber(value); return 0 end
function fake.sqlite3_step() return fake.step end
function fake.sqlite3_finalize() fake.finalized = (fake.finalized or 0) + 1; return 0 end
function fake.sqlite3_column_blob() return "value" end
function fake.sqlite3_column_bytes() return 5 end
function fake.sqlite3_errmsg() return "synthetic database error" end
function fake.sqlite3_close() return 0 end
local db = sqlite.open("private.sqlite", fake)
db:exec("INSERT ...", {"a", 4})
assert(fake.binds[1] == "a" and fake.binds[2] == 4 and fake.finalized == 1)
fake.step = 100
assert(db:one("SELECT ...", {}) == "value")
fake.step = 101
assert(db:one("SELECT ...", {}) == nil)
fake.step = 1
assert(not pcall(function() db:exec("BAD", {}) end) and fake.finalized == 4)
local original_open = fake.sqlite3_open_v2
fake.sqlite3_open_v2 = function(path, ptr) ptr[0] = ffi.cast("sqlite3*", 1); return 14 end
assert(not pcall(function() sqlite.open("private.sqlite", fake) end))
fake.sqlite3_open_v2 = original_open
local original_prepare = fake.sqlite3_prepare_v2
fake.sqlite3_prepare_v2 = function() return 1 end
assert(not pcall(function() db:exec("BAD") end))
fake.sqlite3_prepare_v2 = original_prepare
fake.step = 101
local original_bind = fake.sqlite3_bind_text
fake.sqlite3_bind_text = function() return 1 end
assert(not pcall(function() db:exec("BAD", {"x"}) end))
fake.sqlite3_bind_text = original_bind
assert(not pcall(function() db:exec("BAD", {true}) end))
local original_finalize = fake.sqlite3_finalize
fake.sqlite3_finalize = function() return 1 end
assert(not pcall(function() db:exec("BAD") end))
fake.sqlite3_finalize = original_finalize
fake.step = 100
fake.sqlite3_column_bytes = function() return 0 end
assert(db:one("SELECT", {}) == "")
db:close()
print("sqlite assertions passed")
