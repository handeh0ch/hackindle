-- Connects the capture entry to the server: reads the owner-placed settings,
-- caches the sync profile, configures the entry from it (also offline, from the
-- cache) and drives delivery from a timer. No call here can enable Wi-Fi; every
-- tick is contained so an error never reaches KOReader's scheduler.
local state = require("state")
local codec = require("codec")
local settings_module = require("settings")
local transport_module = require("transport")
local delivery_module = require("delivery")
local M = {}
local has_logger, logger = pcall(require, "logger")
local function warn(...)
    if has_logger and type(logger) == "table" and type(logger.warn) == "function" then pcall(logger.warn, "Hackindle:", ...) end
end

local FIRST_DELAY, OFFLINE_DELAY, IDLE_DELAY, PAUSED_DELAY = 30, 60, 300, 900
local FLUSH_STEPS, FLUSH_SECONDS, MANUAL_STEPS, MANUAL_SECONDS = 5, 20, 20, 60
local UUID = "^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$"

local function read_all(path, limit)
    local handle = io.open(path, "rb")
    if not handle then return nil end
    local text = handle:read(limit or "*a")
    handle:close()
    return text
end
local function whole(value) return type(value) == "number" and value == math.floor(value) and value >= 0 and value <= 9007199254740991 end

local function parse_config(body)
    local ok, config = pcall(codec.decode, body)
    if not ok or type(config) ~= "table" then return nil end
    if config.schema_version ~= 1 or type(config.instance_id) ~= "string" or not config.instance_id:match(UUID)
        or type(config.reporting_timezone) ~= "string" or config.reporting_timezone == ""
        or not whole(config.characters_per_page) or config.characters_per_page < 1 or not whole(config.reset_generation)
        or (config.unicode_version ~= nil and type(config.unicode_version) ~= "string") then return nil end
    return config
end

-- Compares a fetched profile with the one this device already accepted.
local function classify(store, config)
    local raw = store:get("profile")
    if not raw then return nil end
    local policy = codec.decode(raw)
    if policy.instance_id ~= config.instance_id then return "server_changed" end
    if policy.timezone ~= config.reporting_timezone or policy.denominator ~= config.characters_per_page then return "policy_changed" end
    if config.reset_generation < policy.generation then return "generation_regressed" end
    if config.reset_generation > policy.generation then return "reset_detected" end
    return nil
end

local function sha256_of(sha2)
    return function(bytes)
        sha2 = sha2 or require("ffi/sha2")
        local update = sha2.sha256()
        update(bytes)
        return update()
    end
end

function M.start(entry, modules)
    modules = modules or {}
    local storage = modules.datastorage or require("datastorage")
    local read_file = modules.read_file or read_all
    local directory = storage:getSettingsDir()
    local settings, reason = settings_module.load(read_file, directory)
    if not settings then return nil, reason end
    local ui = modules.uimanager or require("ui/uimanager")
    local network = modules.network or require("koreader_network")
    local clock = modules.clock or os.time
    local sha256 = modules.sha256 or sha256_of(modules.sha2)
    local notify = modules.notify or function(text)
        ui:show(require("ui/widget/infomessage"):new{text = text})
    end
    local db = modules.db or require("koreader_sqlite").open()
    local ok, client = pcall(function()
        local store = state.open(db)
        local tag = sha256(settings.url .. "\n" .. settings.token)
        local auth = delivery_module.authenticator()
        local self = {entry = entry, store = store, db = db, auth = auth, tag = tag, refresh_due = true}
        self.transport = transport_module.new(settings, modules.http or require("koreader_http").new())
        local raw, cached_tag = store:get("sync_config"), store:get("sync_config_tag")
        if raw and cached_tag == tag then self.config = parse_config(raw) end

        local function schedule(delay)
            if self.stopped then return end
            ui:unschedule(self.tick_fn)
            ui:scheduleIn(delay, self.tick_fn)
        end
        function self:make_delivery()
            self.delivery = delivery_module.new{store = store, transport = self.transport, clock = clock, auth = auth, tag = tag,
                sha256 = sha256, instance_id = self.config.instance_id, device_id = store:get("device_id"), warn = warn,
                limits = type(self.config.limits) == "table" and self.config.limits or nil,
                hooks = {
                    apply = function(packet, bytes) entry:applyAck(packet, bytes) end,
                    obsolete = function() self.refresh_due = true end,
                }}
        end
        function self:configure()
            local change = classify(store, self.config)
            if change and change ~= "reset_detected" then self.alert = change; return false end
            -- Capture after a server reset needs native baseline evidence that is not
            -- wired yet. Stop with a clear status instead of a half-working capture, but
            -- keep delivering the old queue: the server discards it with obsolete acks.
            if self.config.reset_generation > 0 then
                self.alert = "reset_unsupported"
                self:make_delivery()
                return false
            end
            local deps = {
                db = db,
                authenticated_profile = function(config) return config == self.config end,
                authenticated_ack = auth.verify,
                zoneinfo = {root = settings.zoneinfo_dir or "/usr/share/zoneinfo", read_file = read_file},
                resolve_format = modules.resolve_format or function(reader) return require("koreader_format").resolve(reader) end,
            }
            if not entry:configure(self.config, deps) then self.alert = "initialization_failed"; return false end
            self:make_delivery()
            return true
        end
        -- Returns true (plus the detected change) or nil plus a reason code.
        function self:fetch_config()
            local response = self.transport:get_config()
            if response.error then return nil, "network" end
            if response.status == 401 then return nil, "token_rejected" end
            if response.status ~= 200 then return nil, "http_" .. tostring(response.status) end
            local config = parse_config(response.body)
            if not config then return nil, "bad_config" end
            local change = classify(store, config)
            if change and change ~= "reset_detected" then
                self.alert = change
                if self.delivery then self.delivery:hold(change, change) end
                return nil, change
            end
            store:transaction(function(tx) tx:put("sync_config", response.body); tx:put("sync_config_tag", tag) end)
            if change then self.alert = change end
            if not self.config then
                self.config = config
                if self:configure() then pcall(function() entry:onReaderReady() end) end
            end
            self.refresh_due = false
            return true, change
        end
        local function step_until(limit, seconds)
            local deadline = clock() + seconds
            local outcome = "idle"
            for _ = 1, limit do
                if clock() >= deadline then break end
                outcome = self.delivery:step()
                if outcome ~= "sent" and outcome ~= "progress" then break end
            end
            return outcome
        end
        -- Tells the owner once per pause (reason and code) that the queue stopped, so a
        -- redirect, 404 or 409 is not discovered only by opening the status screen.
        function self:announce_pause()
            local status = self.delivery:status()
            local key = tostring(status.paused) .. ":" .. tostring(status.code)
            if self.announced == key then return end
            self.announced = key
            notify("Hackindle stopped sending: " .. tostring(status.paused) .. (status.code and (" (" .. status.code .. ")") or "")
                .. ". Open Hackindle > Status.")
        end
        function self:run_once()
            if not network.online() then return OFFLINE_DELAY end
            if self.refresh_due and self.config then self:fetch_config() end
            if not self.delivery then return IDLE_DELAY end
            local outcome = self.delivery:step()
            if outcome == "sent" or outcome == "progress" then self.announced = nil; return 1 end
            if outcome == "paused" then pcall(self.announce_pause, self); return PAUSED_DELAY end
            self.announced = nil
            if outcome == "idle" then return IDLE_DELAY end
            local next_at = self.delivery:status().next_at
            return math.max(1, (next_at or clock()) - clock())
        end
        self.tick_fn = function()
            if self.stopped or self.suspended then return end
            local ran, delay = pcall(self.run_once, self)
            if not ran then warn("sync tick failed:", delay); delay = IDLE_DELAY end
            schedule(delay)
        end
        function self:sync_now()
            if not network.online() then notify("No network connection. Connect to Wi-Fi, then try again."); return false end
            if self.delivery then self.delivery:resume() end
            self.announced, self.alert = nil, nil
            if not self.config or self.refresh_due then
                local fetched, why = self:fetch_config()
                if not fetched then notify("Sync failed: " .. tostring(why)); return false end
            end
            if not self.delivery then notify("Sync is not ready: " .. tostring(self.alert or "unconfigured")); return false end
            local outcome = step_until(MANUAL_STEPS, MANUAL_SECONDS)
            notify(self:summary(outcome))
            return true
        end
        -- Bounded attempt to send what the session produced before the book closes.
        function self:flush()
            if self.stopped or not self.delivery or not network.online() then return end
            pcall(step_until, FLUSH_STEPS, FLUSH_SECONDS)
        end
        function self:summary(outcome)
            local lines = {}
            if self.alert == "reset_unsupported" then
                lines[#lines + 1] = "The server was reset. Capture is stopped: reading after a reset is not supported yet. Unsent data is still discarded or delivered as the server decides."
            elseif self.alert then lines[#lines + 1] = "Attention: " .. self.alert end
            if not self.config then lines[#lines + 1] = "Not connected to the server yet. Use Sync now."
            elseif not self.delivery then lines[#lines + 1] = "Capture is not configured."
            else
                local status = self.delivery:status()
                if status.paused then lines[#lines + 1] = "Paused: " .. status.paused .. (status.code and (" (" .. status.code .. ")") or "")
                elseif status.queue == 0 then lines[#lines + 1] = "All data sent."
                else lines[#lines + 1] = status.queue .. " packet(s) waiting" .. (outcome == "retry" and status.last_error and (" (" .. status.last_error .. ")") or "") end
                if status.last_ok then lines[#lines + 1] = "Last success: " .. os.date("%Y-%m-%d %H:%M", status.last_ok) end
            end
            return table.concat(lines, "\n")
        end
        function self:suspend() self.suspended = true; ui:unschedule(self.tick_fn) end
        function self:resume() self.suspended = false; schedule(FIRST_DELAY) end
        function self:close()
            if self.stopped then return end
            self.stopped = true
            ui:unschedule(self.tick_fn)
            pcall(function() db:close() end)
        end
        if self.config then self:configure() end
        schedule(FIRST_DELAY)
        return self
    end)
    if not ok then pcall(function() db:close() end); error(client, 0) end
    return client
end
return M
