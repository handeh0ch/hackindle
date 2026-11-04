-- db is a private SQLite connection; it must raise on any SQL error.
local M = {}
function M.open(db)
    db:exec("CREATE TABLE IF NOT EXISTS capture_state (key TEXT PRIMARY KEY, value BLOB NOT NULL)")
    db:exec("CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY, packet BLOB NOT NULL)")
    local store = {}
    function store:get(key)
        return db:one("SELECT value FROM capture_state WHERE key = ?", {key})
    end
    function store:transaction(work)
        db:exec("BEGIN IMMEDIATE")
        local tx = {}
        function tx:get(key) return store:get(key) end
        function tx:put(key, value)
            db:exec("INSERT OR REPLACE INTO capture_state (key, value) VALUES (?, ?)", {key, value})
        end
        function tx:enqueue(seq, packet)
            db:exec("INSERT INTO outbox (seq, packet) VALUES (?, ?)", {seq, packet})
        end
        local ok, result = pcall(work, tx)
        if ok then
            ok, result = pcall(function() db:exec("COMMIT"); return result end)
        end
        if not ok then
            pcall(function() db:exec("ROLLBACK") end)
            error(result, 0)
        end
        return result
    end
    return store
end
function M.next_counter(tx, key)
    local stored = tx:get(key)
    local previous = stored and tonumber(stored) or 0
    assert((not stored or (stored:match("^%d+$") and previous)) and previous < 9007199254740991, "invalid sequence")
    local next_seq = previous + 1
    tx:put(key, string.format("%.0f", next_seq))
    return next_seq
end
function M.claim_event(tx, id)
    assert(type(id) == "string" and id ~= "", "event identity unavailable")
    local key = "event_id:" .. id:lower()
    assert(not tx:get(key), "event identity already used")
    tx:put(key, "used")
end
function M.assert_capture_enabled(tx)
    assert(tx:get("capture_generation") == "0", "capture paused: reset baseline integration required")
end
function M.next_sequence(tx) return M.next_counter(tx, "seq") end
return M
