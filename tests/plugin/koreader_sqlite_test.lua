package.path = "plugin/?.lua;" .. package.path
local adapter = require("koreader_sqlite")
local history, current = {}, nil
local conn = {}
function conn:prepare(sql)
    local stmt = {sql=sql, args={}}
    function stmt:bind1(i, value) self.args[i]=value; return self end
    function stmt:step()
        if self.sql == "SELECT" then
            if self.read then return nil end
            self.read=true; return {"stored"}
        end
        if self.sql == "FAIL" then error("synthetic failure") end
        history[#history+1]={sql=self.sql,args=self.args}
        return nil
    end
    function stmt:close() self.closed=true; current=self end
    return stmt
end
function conn:close() self.closed=true end
local sq3={open=function(path) assert(path == "/synthetic/settings/kindle-sync.sqlite3"); return conn end}
local storage={getSettingsDir=function() return "/synthetic/settings" end}
local db=adapter.open(storage,sq3)
db:exec("INSERT",{"key",42})
assert(history[1].args[1] == "key" and history[1].args[2] == 42 and current.closed)
assert(db:one("SELECT",{"key"}) == "stored" and current.closed)
assert(not pcall(function() db:exec("FAIL") end) and current.closed)
db:close(); assert(conn.closed)
print("KOReader SQLite adapter assertions passed")
local badstmt={}
function badstmt:bind1() error("bind failed") end
function badstmt:close() self.closed=true end
local broken={prepare=function() return badstmt end,close=function() end}
local db2=adapter.open(storage,{open=function() return broken end})
assert(not pcall(function() db2:exec("INSERT",{"x"}) end) and badstmt.closed)
local multi={prepare=function() return {bind1=function() end,step=function() return {"x"} end,close=function() end} end,close=function() end}
local db3=adapter.open(storage,{open=function() return multi end})
assert(not pcall(function() db3:one("SELECT") end))
assert(not pcall(function() adapter.open({getSettingsDir=function() return "" end},sq3) end))
local fake_blob={open=function() return conn end,blob=function(value) return {binary=value} end}
local db4=adapter.open(storage,fake_blob)
db4:exec("INSERT INTO outbox (seq, packet) VALUES (?, ?)",{1,"wire bytes"})
assert(history[#history].args[2].binary == "wire bytes")
db4:exec("INSERT OR REPLACE INTO capture_state (key, value) VALUES (?, ?)",{ "x", "state bytes"})
assert(history[#history].args[1] == "x" and history[#history].args[2].binary == "state bytes")
local binary="a\0b"
db4:exec("INSERT INTO outbox (seq, packet) VALUES (?, ?)",{2,binary})
assert(history[#history].args[2].binary == binary and #history[#history].args[2].binary == 3)
local closefail={prepare=function() return {step=function() return nil end,close=function() error("close failed") end} end,close=function() end}
local db5=adapter.open(storage,{open=function() return closefail end})
assert(not pcall(function() db5:exec("BEGIN IMMEDIATE") end))
