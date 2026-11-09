package.path = "projects/plugin/?.lua;" .. package.path
local state = require("storage.state")
local db = {calls = {}, rows = {}}
function db:exec(sql, args)
    self.calls[#self.calls + 1] = {sql = sql, args = args}
    if sql == "BEGIN IMMEDIATE" then self.saved = {}; for k,v in pairs(self.rows) do self.saved[k]=v end end
    if sql == "ROLLBACK" then self.rows = self.saved end
    if sql:match("INSERT OR REPLACE INTO capture_state") then self.rows[args[1]] = args[2] end
    if sql:match("INSERT INTO outbox") then self.rows["outbox:" .. args[1]] = args[2] end
end
function db:one(sql, args) return self.rows[args[1]] end
local store = state.open(db)
store:transaction(function(tx)
    tx:put("source:one", "state-v1")
    tx:enqueue(1, "packet-v1")
end)
assert(db.rows["source:one"] == "state-v1" and db.rows["outbox:1"] == "packet-v1")
assert(store:get("source:one") == "state-v1")
assert(db.calls[#db.calls].sql == "COMMIT")
local ok = pcall(function() store:transaction(function(tx)
    tx:put("source:one", "wrong")
    tx:enqueue(2, "wrong")
    error("failure")
end) end)
assert(not ok and db.rows["source:one"] == "state-v1" and db.rows["outbox:2"] == nil)
assert(db.calls[#db.calls].sql == "ROLLBACK")
print("state assertions passed")
assert(not pcall(function() state.assert_capture_enabled({get=function() return nil end}) end))
assert(not pcall(function() state.assert_capture_enabled({get=function() return "1" end}) end))
assert(state.assert_capture_enabled({get=function() return "0" end}) == nil)
