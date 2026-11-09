-- Shared synthetic fixtures for P2 tests: an in-memory SQLite stand-in with real
-- transaction semantics for the two state tables, and canned packets/acks.
local json = require("protocol.wire_json")
local M = {}
M.instance = "48bc0344-efad-4c68-adb6-dc0f0ba57276"
M.device = "7f8a2a30-1c4e-4f55-9d3a-0a1b2c3d4e5f"

local function clone(t) local out = {}; for k, v in pairs(t) do out[k] = v end; return out end
function M.memory_db()
    local db = {rows = {}, outbox = {}, statements = 0}
    function db:exec(sql, args)
        self.statements = self.statements + 1
        if sql == "BEGIN IMMEDIATE" then self.backup = {rows = clone(self.rows), outbox = clone(self.outbox)}
        elseif sql == "ROLLBACK" then self.rows, self.outbox = self.backup.rows, self.backup.outbox
        elseif sql:match("^INSERT OR REPLACE INTO capture_state") then self.rows[args[1]] = args[2]
        elseif sql:match("^INSERT INTO outbox") then self.outbox[args[1]] = args[2]
        elseif sql:match("^DELETE FROM outbox WHERE seq") then self.outbox[args[1]] = nil
        end
    end
    function db:one(sql, args)
        if sql:match("^SELECT value FROM capture_state") then return self.rows[args[1]] end
        if sql:match("^SELECT seq FROM outbox") then
            local lowest
            for seq in pairs(self.outbox) do if not lowest or seq < lowest then lowest = seq end end
            return lowest
        end
        if sql:match("^SELECT packet FROM outbox") then return self.outbox[args[1]] end
        if sql:match("^SELECT COUNT") then local n = 0; for _ in pairs(self.outbox) do n = n + 1 end; return n end
    end
    function db:close() self.closed = true end
    return db
end

-- A syntactically valid envelope for delivery tests; delivery never validates payload content.
function M.packet(seq, kind, extra)
    kind = kind or "vocabulary_snapshot"
    local payload
    if kind == "vocabulary_snapshot" then payload = {version = seq, words = json.array({})}
    elseif kind == "legacy_statistics" then payload = {version = seq, records = json.array({})}
    elseif kind == "reading_events" then payload = {events = json.array({{event_id = "11111111-1111-4111-8111-111111111111"}})}
    else payload = {metadata = {version = 1, value = {}}} end
    for k, v in pairs(extra or {}) do payload[k] = v end
    local source = json.null
    if kind == "reading_events" or kind == "source_snapshot" or kind == "legacy_statistics" then source = ("a"):rep(64) end
    return json.encode({schema_version = 1, instance_id = M.instance, device_id = M.device, reset_generation = 0, seq = seq,
        captured_at = "2026-01-01T00:00:00Z", kind = kind, source_id = source, payload = payload})
end

function M.ack(packet_text, patch)
    local packet = require("protocol.codec").decode(packet_text)
    local results = {}
    if packet.kind == "reading_events" then results[packet.payload.events[1].event_id] = "applied"
    elseif packet.kind == "source_snapshot" then results.metadata = "applied"
    else results[packet.kind] = "applied" end
    local ack = {schema_version = 1, instance_id = packet.instance_id, device_id = packet.device_id, reset_generation = packet.reset_generation,
        source_id = packet.source_id, seq = packet.seq, kind = packet.kind, status = "applied", results = results,
        current_reset_generation = packet.reset_generation}
    for k, v in pairs(patch or {}) do ack[k] = v end
    return ack
end
return M
