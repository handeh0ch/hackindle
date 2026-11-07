package.path = "plugin/?.lua;tests/plugin/?.lua;" .. package.path
package.preload["ui/widget/container/widgetcontainer"] = function()
    return {extend = function(_, spec) spec.__index = spec; return spec end}
end
local Entry = dofile("plugin/main.lua")
local source = ("a"):rep(64)
local function new(ui) local entry = setmetatable({ui = ui or {}}, Entry); entry:init(); return entry end

-- The entry registers its menu and starts the server connection from the module.
local registered
local menu_entry = new({menu = {registerToMainMenu = function(_, item) registered = item end}})
assert(registered == menu_entry and menu_entry.sync == nil and menu_entry.sync_error)
local fake_sync = {calls = {}}
for _, name in ipairs({"suspend", "resume", "flush", "close", "sync_now"}) do
    fake_sync[name] = function(self) self.calls[#self.calls + 1] = name; return true end
end
function fake_sync:summary() return "summary text" end
local starts = {}
package.loaded["koreader_client"] = {start = function(entry, modules) starts[#starts + 1] = modules; return fake_sync end}
local entry = new()
assert(entry.sync == fake_sync and starts[1] == nil)
package.loaded["koreader_client"] = {start = function() return nil, "not_configured" end}
assert(new().sync == nil)
package.loaded["koreader_client"] = {start = function() error("broken", 0) end}
assert(new().sync_error == "broken")
package.loaded["koreader_client"] = {start = function() return fake_sync end}

-- Acknowledgements reach the matching capture hook, preferring the open source.
local hooks = {}
local function spy(name, result) return function(_, ...) hooks[#hooks + 1] = name; return result end end
local app = {source_metadata_ack = spy("app.metadata"), reset_source_metadata_ack = spy("app.reset_metadata"),
    legacy_ack = spy("app.legacy"), vocabulary_reset_ack = spy("app.vocabulary")}
local target = new()
assert(not pcall(target.applyAck, target, {kind = "source_snapshot"}, "ack"))
target.runtime = {app = app}
target:applyAck({kind = "source_snapshot", reset_generation = 0, source_id = source}, "ack")
target:applyAck({kind = "source_snapshot", reset_generation = 2, source_id = source}, "ack")
target:applyAck({kind = "legacy_statistics", source_id = source}, "ack")
target:applyAck({kind = "vocabulary_snapshot"}, "ack")
target:applyAck({kind = "reading_events"}, "ack")
assert(table.concat(hooks, ",") == "app.metadata,app.reset_metadata,app.legacy,app.vocabulary")
hooks = {}
target.runtime = nil; target.app = app
target.source_ready, target.source_id, target.source_reset = true, source, true
target.metadata_ack = spy("entry.metadata"); target.legacy_ack = spy("entry.legacy")
target:applyAck({kind = "source_snapshot", reset_generation = 0, source_id = source}, "ack")
target:applyAck({kind = "source_snapshot", reset_generation = 0, source_id = ("b"):rep(64)}, "ack")
target:applyAck({kind = "legacy_statistics", source_id = source}, "ack")
target.source_reset = false
target:applyAck({kind = "legacy_statistics", source_id = source}, "ack")
assert(table.concat(hooks, ",") == "entry.metadata,app.metadata,entry.legacy,app.legacy")

-- Owner-driven lifecycle actions.
local finished, cycles = {}, {}
local lifecycle_app = {finish_book = function(_, at, uuid, verified) finished[#finished + 1] = {at, uuid(), verified}; return #finished == 1 end,
    begin_cycle = function(_, at, uuid, verified) cycles[#cycles + 1] = {at, uuid(), verified}; return true end}
local adapter = {lifecycle = function(_, ui, event)
    return {verified = true, source_id = source, captured_at = "time", uuid = function() return event end}
end}
local actions = new()
assert(actions:finishBook() == nil and actions:startNewCycle() == nil)   -- nothing attached yet
actions.app, actions.adapter, actions.source_ready, actions.source_id = lifecycle_app, adapter, true, source
assert(actions:finishBook() == true and actions:finishBook() == false and finished[1][2] == "finish" and finished[1][3] == true)
assert(actions:startNewCycle() == true and cycles[1][2] == "cycle")
actions:onEndOfBook(); assert(#finished == 3)
actions.suspended = true; assert(actions:finishBook() == nil); actions.suspended = false
actions.app = {}; assert(actions:finishBook() == nil); actions.app = lifecycle_app
actions.adapter = {lifecycle = function() error("unavailable", 0) end}
assert(actions:startNewCycle() == nil and actions.status == "capture_unavailable")
actions.adapter = {lifecycle = function() return {verified = true, source_id = ("b"):rep(64), uuid = function() end} end}
assert(actions:finishBook() == nil)

-- Menu entries.
local messages = {}
function actions:notify(text) messages[#messages + 1] = text end
actions.adapter, actions.sync = adapter, nil
local items = {}
actions:addToMainMenu(items)
local menu = items.kindle_sync
assert(menu.text == "Kindle Sync" and #menu.sub_item_table == 4)
local status, sync_now, finish, cycle = unpack(menu.sub_item_table)
status.callback(); assert(messages[1]:find("Not configured", 1, true))
assert(sync_now.enabled_func() == false); sync_now.callback()
actions.sync = fake_sync
assert(sync_now.enabled_func() == true)
status.callback(); assert(messages[2] == "summary text")
sync_now.callback(); assert(fake_sync.calls[#fake_sync.calls] == "sync_now")
actions.source_ready = false
assert(finish.enabled_func() == false and cycle.enabled_func() == false)
actions.source_ready = true
assert(finish.enabled_func() == true and cycle.enabled_func() == true)
lifecycle_app.finish_book = function() return true end
finish.callback(); assert(messages[3] == "Book marked as finished.")
lifecycle_app.finish_book = function() return false end
finish.callback(); assert(messages[4]:find("Not recorded", 1, true))
cycle.callback(); assert(messages[5] == "New read cycle started.")
lifecycle_app.begin_cycle = function() return false end
cycle.callback(); assert(messages[6]:find("Not started", 1, true))

-- Messages go through KOReader's UI; a UI failure is only logged.
local shown
package.preload["ui/uimanager"] = function() return {show = function(_, widget) shown = widget.text end} end
package.preload["ui/widget/infomessage"] = function() return {new = function(_, spec) return spec end} end
Entry.notify(menu_entry, "hello"); assert(shown == "hello")
package.loaded["ui/uimanager"] = nil; package.preload["ui/uimanager"] = function() error("no ui") end
Entry.notify(menu_entry, "ignored")

-- Suspend, resume and close drive the connection timer and the final delivery attempt.
local lifecycle = new()
lifecycle.sync = fake_sync
fake_sync.calls = {}
local close_app = {session_close = function() end}
lifecycle.app, lifecycle.adapter, lifecycle.source_ready, lifecycle.source_id = close_app, {}, true, source
lifecycle.runtime = {close = function() end}
lifecycle:onSuspend(); lifecycle:onResume(); lifecycle:onResume()
assert(table.concat(fake_sync.calls, ",") == "suspend,resume")
lifecycle:onCloseDocument()
assert(table.concat(fake_sync.calls, ",") == "suspend,resume,flush,close" and lifecycle.sync == nil and lifecycle.closed)
local suspended_close = new()
suspended_close.sync = fake_sync; fake_sync.calls = {}
suspended_close.suspended = true
suspended_close:onCloseDocument()
assert(table.concat(fake_sync.calls, ",") == "close")
local widget_closed = new()
widget_closed.sync = fake_sync; fake_sync.calls = {}
widget_closed:onCloseWidget(); widget_closed:onCloseWidget()
assert(table.concat(fake_sync.calls, ",") == "close" and widget_closed.sync == nil)
print("KOReader entry sync assertions passed")
