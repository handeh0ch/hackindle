package.path = "projects/plugin/?.lua;tests/plugin/?.lua;" .. package.path
local support = require("support")
local state = require("storage.state")
local codec = require("protocol.codec")
local json = require("protocol.wire_json")
local client_module = require("koreader.koreader_client")

local token = "AbC_123-xyz_AbC_123-xyz"
local files = {}
local scheduled, unscheduled, shown, notices = {}, 0, {}, {}
local online, now = true, 5000
local routes = {}
local requests = {}
local function conf(url) return 'url = "' .. url .. '"\ntoken = "' .. token .. '"\n' end
local function config_body(overrides)
    local config = {schema_version = 1, instance_id = support.instance, reset_generation = 0, reporting_timezone = "UTC",
        characters_per_page = 2000, unicode_version = "16.0",
        limits = {direct_bytes = 1048576, envelope_bytes = 16777216, chunk_bytes = 1048576, upload_ttl_seconds = 604800, open_uploads = 2}}
    for k, v in pairs(overrides or {}) do config[k] = v end
    return json.encode(config)
end
local function modules(db, extra)
    local m = {
        datastorage = {getSettingsDir = function() return "/cfg" end},
        read_file = function(path) return files[path] end,
        uimanager = {scheduleIn = function(_, delay, fn) scheduled[#scheduled + 1] = {delay = delay, fn = fn} end,
            unschedule = function() unscheduled = unscheduled + 1 end},
        network = {online = function() return online end},
        clock = function() return now end,
        sha256 = function(bytes) return ("%064x"):format(#bytes) end,
        db = db,
        notify = function(text) notices[#notices + 1] = text end,
        resolve_format = function() return {verified = true, format = "epub"} end,
        http = function(request)
            requests[#requests + 1] = request
            local route = routes[request.method .. " " .. request.url:gsub("^https://sync%.example%.org", "")]
            return route and route(request) or {status = 404, headers = {}, body = ""}
        end,
    }
    for k, v in pairs(extra or {}) do m[k] = v end
    return m
end
local function fake_entry()
    local entry = {configured = {}, acks = {}, ready = 0}
    function entry:configure(config, deps) self.configured[#self.configured + 1] = {config = config, deps = deps}; return self.configure_result ~= false end
    function entry:applyAck(packet, bytes) if self.ack_error then error("ack failed", 0) end; self.acks[#self.acks + 1] = {packet = packet, bytes = bytes} end
    function entry:onReaderReady() self.ready = self.ready + 1 end
    return entry
end
local function last_tick() return scheduled[#scheduled] end
local function run_tick() local item = table.remove(scheduled); item.fn(); return last_tick() end

-- No settings file, or an invalid one: capture stays unconfigured.
local db = support.memory_db()
local value, reason = client_module.start(fake_entry(), modules(db))
assert(value == nil and reason == "not_configured")
files["/cfg/hackindle.conf"] = "garbage"
value, reason = client_module.start(fake_entry(), modules(db))
assert(value == nil and reason == "settings_invalid")
files["/cfg/hackindle.conf"] = conf("https://sync.example.org")

-- First run: nothing is configured until the profile has been fetched once.
local entry = fake_entry()
local client = client_module.start(entry, modules(db))
assert(client and #entry.configured == 0 and scheduled[1].delay == 30)
assert(client:summary():find("Not connected to the server yet", 1, true))
online = false
assert(client:sync_now() == false and notices[#notices]:find("No network", 1, true))
online = true
assert(client:flush() == nil and #requests == 0)   -- nothing to flush without delivery
local failures = {
    {{error = "x"}, "network"}, {{status = 401, headers = {}, body = ""}, "token_rejected"}, {{status = 500, headers = {}, body = ""}, "http_500"},
    {{status = 200, headers = {}, body = "{"}, "bad_config"},
}
for _, case in ipairs(failures) do
    routes["GET /api/v1/sync/config"] = function() return case[1] end
    assert(client:sync_now() == false and notices[#notices] == "Sync failed: " .. case[2])
end
routes["GET /api/v1/sync/config"] = function() return {status = 200, headers = {}, body = config_body()} end
assert(client:sync_now() == true)
assert(#entry.configured == 1 and entry.ready == 1 and notices[#notices]:find("All data sent", 1, true))
local deps = entry.configured[1].deps
assert(deps.db == db and deps.authenticated_profile(entry.configured[1].config) and not deps.authenticated_profile({}))
assert(deps.zoneinfo.root == "/usr/share/zoneinfo" and type(deps.zoneinfo.read_file) == "function")
assert(deps.resolve_format({}).format == "epub" and type(deps.authenticated_ack) == "function")
local request = requests[#requests]
assert(request.headers["Authorization"] == "Bearer " .. token)
assert(db.rows.sync_config and db.rows.sync_config_tag == ("%064x"):format(#("https://sync.example.org\n" .. token)))

-- Delivery works through the entry hook; a packet leaves the queue only after its ack.
db.rows.device_id = support.device
local packet = support.packet(1)
state.open(db):transaction(function(tx) tx:enqueue(1, packet) end)
client.delivery = nil; client:make_delivery()
routes["POST /api/v1/sync"] = function(req)
    assert(req.body == packet)
    return {status = 200, headers = {}, body = json.encode(support.ack(packet))}
end
assert(client:sync_now() == true and db.outbox[1] == nil and #entry.acks == 1 and entry.acks[1].packet.seq == 1)
assert(client:summary("sent"):find("Last success", 1, true))
-- Ticks: offline, idle, backlog and failures choose the next delay and never raise.
local queue_seq = 2
local function enqueue_next() local text = support.packet(queue_seq); state.open(db):transaction(function(tx) tx:enqueue(queue_seq, text) end); queue_seq = queue_seq + 1; return text end
online = false; assert(run_tick().delay == 60)
online = true; assert(run_tick().delay == 300)   -- refresh_due fetches the profile, queue is empty
local text = enqueue_next()
routes["POST /api/v1/sync"] = function() return {error = "x"} end
assert(run_tick().delay == 5)
now = now + 5
routes["POST /api/v1/sync"] = function() return {status = 200, headers = {}, body = json.encode(support.ack(text))} end
assert(run_tick().delay == 1 and db.outbox[2] == nil)
text = enqueue_next()
routes["POST /api/v1/sync"] = function() return {status = 401, headers = {}, body = ""} end
local notices_before_pause = #notices
assert(run_tick().delay == 900)
assert(client.delivery:status().paused == "token_rejected" and run_tick().delay == 900)
-- The owner is told once when a pause stops the queue, not on every later tick.
assert(#notices == notices_before_pause + 1 and notices[#notices]:find("token_rejected", 1, true))
assert(client:summary():find("Paused: token_rejected", 1, true))
-- sync_now resumes a paused queue.
routes["POST /api/v1/sync"] = function() return {status = 200, headers = {}, body = json.encode(support.ack(text))} end
assert(client:sync_now() == true and db.outbox[3] == nil)
-- A failing tick body is contained and rescheduled.
local original = client.run_once
client.run_once = function() error("boom") end
assert(run_tick().delay == 300)
client.run_once = original
-- Flush is bounded and ignores failures.
text = enqueue_next()
routes["POST /api/v1/sync"] = function() return {status = 200, headers = {}, body = json.encode(support.ack(text))} end
client:flush(); assert(db.outbox[4] == nil)
text = enqueue_next()
routes["POST /api/v1/sync"] = function() error("flush failure") end
client.delivery.step = function() error("step failure") end
assert(client:flush() == nil)
online = false; client:flush(); online = true

-- Restart: the cached profile configures capture without any network request.
local entry2 = fake_entry()
local before = #requests
local client2 = client_module.start(entry2, modules(db))
assert(#entry2.configured == 1 and #requests == before and client2.delivery)
-- Changed settings invalidate the cache.
files["/cfg/hackindle.conf"] = conf("https://other.example.org")
local entry3 = fake_entry()
assert(client_module.start(entry3, modules(db)) and #entry3.configured == 0)
files["/cfg/hackindle.conf"] = conf("https://sync.example.org")

-- Profile changes: another server never receives the queue; a reset only refreshes the cache.
local store = state.open(db)
store:transaction(function(tx) tx:put("profile", codec.encode({instance_id = support.instance, timezone = "UTC", denominator = 2000, generation = 0, baselines = {}, baseline_required = false})) end)
local entry4 = fake_entry()
local client4 = client_module.start(entry4, modules(db))
for _, case in ipairs({{{instance_id = support.device}, "server_changed"}, {{reporting_timezone = "Europe/Paris"}, "policy_changed"},
    {{characters_per_page = 1000}, "policy_changed"}}) do
    routes["GET /api/v1/sync/config"] = function() return {status = 200, headers = {}, body = config_body(case[1])} end
    client4.alert = nil
    local fetched, why = client4:fetch_config()
    assert(fetched == nil and why == case[2] and client4.alert == case[2])
    assert(client4.delivery:status().paused == case[2])
    assert(client4:sync_now() == false and notices[#notices] == "Sync failed: " .. case[2])
end
client4.delivery:resume()
local cached = db.rows.sync_config
routes["GET /api/v1/sync/config"] = function() return {status = 200, headers = {}, body = config_body({reset_generation = 3})} end
client4.alert = nil
local fetched, change = client4:fetch_config()
assert(fetched == true and change == "reset_detected" and client4.alert == "reset_detected" and db.rows.sync_config ~= cached)
assert(#entry4.configured == 1 and client4:summary():find("Attention: reset_detected", 1, true))
store:transaction(function(tx) tx:put("profile", codec.encode({instance_id = support.instance, timezone = "UTC", denominator = 2000, generation = 5, baselines = {}, baseline_required = false})) end)
routes["GET /api/v1/sync/config"] = function() return {status = 200, headers = {}, body = config_body({reset_generation = 3})} end
local regressed, why = client4:fetch_config()
assert(regressed == nil and why == "generation_regressed")
-- A cached profile from another server is not used to configure capture.
local entry5 = fake_entry()
db.rows.sync_config = config_body({instance_id = support.device})
local client5 = client_module.start(entry5, modules(db))
assert(#entry5.configured == 0 and client5.alert == "server_changed")

-- Configuration failures are reported and block delivery.
local db6 = support.memory_db()
local entry6 = fake_entry(); entry6.configure_result = false
local client6 = client_module.start(entry6, modules(db6))
routes["GET /api/v1/sync/config"] = function() return {status = 200, headers = {}, body = config_body()} end
assert(client6:sync_now() == false and client6.alert == "initialization_failed" and client6.delivery == nil)
assert(notices[#notices]:find("Sync is not ready", 1, true) and client6:summary():find("Capture is not configured", 1, true))
client6.alert = nil; client6.refresh_due = false
assert(client6:sync_now() == false and notices[#notices]:find("unconfigured", 1, true))
assert(client6:run_once() == 300)

-- Obsolete acknowledgements ask for a profile refresh; hook failures keep the packet.
local db7 = support.memory_db()
local entry7 = fake_entry()
local client7 = client_module.start(entry7, modules(db7))
assert(client7:sync_now() == true)
db7.rows.device_id = support.device
client7.delivery = nil; client7:make_delivery()
local obsolete_packet = support.packet(1)
state.open(db7):transaction(function(tx) tx:enqueue(1, obsolete_packet) end)
routes["POST /api/v1/sync"] = function() return {status = 200, headers = {}, body = json.encode(support.ack(obsolete_packet,
    {status = "obsolete_discarded", current_reset_generation = 1, results = {vocabulary_snapshot = "discarded"}}))} end
client7.refresh_due = false
assert(client7:sync_now() == true and client7.refresh_due == true)
assert(db7.outbox[1] == nil)
client7.delivery:step()
state.open(db7):transaction(function(tx) tx:enqueue(2, support.packet(2)) end)
entry7.ack_error = true
routes["POST /api/v1/sync"] = function() return {status = 200, headers = {}, body = json.encode(support.ack(db7.outbox[2]))} end
client7:sync_now()
assert(db7.outbox[2] ~= nil)
entry7.ack_error = false

-- Suspend stops ticks; close stops everything and closes the database once.
client7:suspend(); local count = #scheduled
client7.tick_fn(); assert(#scheduled == count)
client7:resume(); assert(last_tick().delay == 30)
client7:close(); client7:close()
assert(db7.closed)
local after = #scheduled
client7.tick_fn(); client7:flush(); assert(#scheduled == after)
client7:resume(); assert(#scheduled == after)

-- After a server reset capture is stopped with a clear status, but delivery still drains the queue.
local db12 = support.memory_db()
local entry12 = fake_entry()
local client12 = client_module.start(entry12, modules(db12))
routes["GET /api/v1/sync/config"] = function() return {status = 200, headers = {}, body = config_body({reset_generation = 3})} end
db12.rows.device_id = support.device
local stale = support.packet(1)
state.open(db12):transaction(function(tx) tx:enqueue(1, stale) end)
routes["POST /api/v1/sync"] = function() return {status = 200, headers = {}, body = json.encode(support.ack(stale,
    {status = "obsolete_discarded", current_reset_generation = 3, results = {vocabulary_snapshot = "discarded"}}))} end
assert(client12:sync_now() == true)
assert(#entry12.configured == 0 and client12.alert == "reset_unsupported" and db12.outbox[1] == nil)
assert(client12:summary():find("Capture is stopped", 1, true) and not client12:summary():find("Attention", 1, true))
local entry13 = fake_entry()
local client13 = client_module.start(entry13, modules(db12))   -- restart on the cached reset profile
assert(#entry13.configured == 0 and client13.alert == "reset_unsupported" and client13.delivery)

-- A failing start closes the database it opened.
local db8 = support.memory_db()
local broken = modules(db8, {http = false})
broken.http = nil
assert(not pcall(client_module.start, fake_entry(), broken) and db8.closed)

-- Default collaborators: InfoMessage notification, SHA-256 binding, real file reads.
package.preload["ui/widget/infomessage"] = function() return {new = function(_, spec) return spec end} end
local shown_text
local ui = {scheduleIn = function() end, unschedule = function() end, show = function(_, widget) shown_text = widget.text end}
local db9 = support.memory_db()
local sha_fed
local defaults = modules(db9, {notify = false, uimanager = ui, sha256 = false,
    sha2 = {sha256 = function() return function(bytes) if bytes then sha_fed = bytes else return ("ab"):rep(32) end end end}})
defaults.notify = nil; defaults.sha256 = nil
local client9 = client_module.start(fake_entry(), defaults)
online = false
client9:sync_now()
assert(shown_text:find("No network", 1, true) and sha_fed == "https://sync.example.org\n" .. token)
assert(db9.rows.sync_config == nil)
local directory = ".local/harness"
local handle = assert(io.open(directory .. "/hackindle.conf", "wb"))
handle:write(conf("https://file.example.org")); handle:close()
local from_disk = modules(support.memory_db(), {datastorage = {getSettingsDir = function() return directory end}, read_file = false})
from_disk.read_file = nil
local client10 = client_module.start(fake_entry(), from_disk)
os.remove(directory .. "/hackindle.conf")
assert(client10 and client10.transport)
local reader = io.open(directory .. "/limit.bin", "wb"); reader:write(("z"):rep(100)); reader:close()
local entry11 = fake_entry()
files["/cfg/hackindle.conf"] = conf("https://sync.example.org")
local db11 = support.memory_db()
local tag_text = "https://sync.example.org" .. string.char(10) .. token
db11.rows.sync_config = config_body(); db11.rows.sync_config_tag = ("%064x"):format(#tag_text)
local real_read = modules(db11, {read_file = false}); real_read.read_file = nil
real_read.datastorage = {getSettingsDir = function() return directory end}
local settings_text = conf("https://sync.example.org")
local again = io.open(directory .. "/hackindle.conf", "wb"); again:write(settings_text); again:close()
client_module.start(entry11, real_read)
local limited = entry11.configured[1].deps.zoneinfo.read_file(directory .. "/limit.bin", 10)
os.remove(directory .. "/hackindle.conf"); os.remove(directory .. "/limit.bin")
assert(#limited == 10 and entry11.configured[1].deps.zoneinfo.read_file(directory .. "/missing.bin", 10) == nil)
online = true
print("KOReader client assertions passed")
