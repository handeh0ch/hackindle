package.path = "projects/plugin/?.lua;tests/plugin/?.lua;" .. package.path
local format = require("koreader.device.koreader_format")
local network = require("koreader.device.koreader_network")
local http_adapter = require("koreader.device.koreader_http")

-- Format verification reads file content, not only the extension.
local function opener(head, fail)
    return function(path)
        if path:find("missing", 1, true) then return nil end
        return {read = function(_, n) assert(n == 68); if fail then error("read failed") end; return head end, close = function() end}
    end
end
local function resolve(path, head, fail) return format.resolve({document = {file = path}}, opener(head, fail)) end
assert(resolve("/b/x.pdf", "%PDF-1.7 rest").format == "pdf" and resolve("/b/x.PDF", "%PDF-1.4").verified)
assert(resolve("/b/x.epub", "PK\3\4rest").format == "epub")
assert(resolve("/b/x.azw3", ("z"):rep(60) .. "BOOKMOBI").format == "mobi" and resolve("/b/x.mobi", ("z"):rep(60) .. "BOOKMOBI").verified)
assert(not resolve("/b/x.pdf", "PK\3\4").verified and not resolve("/b/x.epub", "%PDF-").verified)
assert(not resolve("/b/x.mobi", "short").verified and not resolve("/b/x.txt", "%PDF-").verified and not resolve("/b/noext", "%PDF-").verified)
assert(not resolve("/b/missing.pdf", "%PDF-").verified and not resolve("/b/x.pdf", nil).verified and not resolve("/b/x.pdf", "%PDF-", true).verified)
assert(not format.resolve({}, opener("")).verified and not format.resolve(nil, opener("")).verified and not format.resolve({document = {file = 1}}, opener("")).verified)
local real = io.open("tests/plugin/support.lua", "rb")
assert(real and not format.resolve({document = {file = "tests/plugin/support.lua"}}).verified)
real:close()

-- Only an established connection counts; every failure means offline.
assert(network.online({isConnected = function() return true end}) == true)
assert(network.online({isConnected = function() return false end}) == false)
assert(network.online({isConnected = function() return 1 end}) == false)
assert(network.online({isConnected = function() error("no") end}) == false)
assert(network.online({}) == false)
assert(network.online() == false)   -- the KOReader module is absent outside the reader

-- HTTP binding: scheme selection, bounded sink, timeouts reset even on failure.
local events = {}
local function modules(handler)
    local m = {}
    m.http = {request = function(spec) events[#events + 1] = "http"; return handler(spec) end}
    m.https = {request = function(spec) events[#events + 1] = "https"; return handler(spec) end}
    m.ltn12 = {source = {string = function(body) return "source:" .. body end}}
    m.socketutil = {set_timeout = function(_, block, total) events[#events + 1] = "timeout:" .. block .. ":" .. total end,
        reset_timeout = function() events[#events + 1] = "reset" end}
    return m
end
local function request(url, body) return {method = "POST", url = url, headers = {a = "b"}, body = body, timeout = {block = 5, total = 30}, max_body = 10} end
local call = http_adapter.new(modules(function(spec)
    assert(spec.method == "POST" and spec.headers.a == "b" and spec.source == "source:payload")
    assert(spec.sink(nil) == 1 and spec.sink("abc") == 1 and spec.sink("def") == 1)
    return 1, 200, {["content-type"] = "x"}, "HTTP/1.1 200 OK"
end))
local response = call(request("https://sync.example.org/api", "payload"))
assert(response.status == 200 and response.body == "abcdef" and response.headers["content-type"] == "x")
assert(events[1] == "timeout:5:30" and events[2] == "https" and events[3] == "reset")
events = {}
assert(call(request("https://sync.example.org/api", "payload")).status == 200)   -- fresh buffers per request
call = http_adapter.new(modules(function(spec)
    assert(spec.source == nil)
    local accepted, why = spec.sink(("x"):rep(11))
    assert(accepted == nil and why == "response too large")
    return nil, why
end))
events = {}
assert(call(request("http://localhost:3000/api")).error == "network" and events[2] == "http" and events[3] == "reset")
for _, handler in ipairs({function() error("socket failure") end, function() return 1, "oops" end, function() return nil, "timeout" end}) do
    assert(http_adapter.new(modules(handler))(request("https://x.example/")).error == "network")
end
local sloppy = modules(function() return 1, 204, {}, "" end)
sloppy.socketutil.reset_timeout = function() error("reset failed") end
assert(http_adapter.new(sloppy)(request("https://x.example/")).status == 204)
assert(not pcall(http_adapter.new))   -- the KOReader modules are absent outside the reader
-- Redirects are never followed (the bearer token would follow them) and a slow body hits the total limit.
local seen_spec
local timed = 0
local slow = modules(function(spec)
    seen_spec = spec
    assert(spec.sink("a") == 1)
    timed = 100
    local accepted, why = spec.sink("b")
    assert(accepted == nil and why == "total timeout")
    return nil, why
end)
slow.clock = function() return timed end
assert(http_adapter.new(slow)(request("https://x.example/")).error == "network" and seen_spec.redirect == false)
print("P2 adapter assertions passed")
