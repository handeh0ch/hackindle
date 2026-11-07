package.path = "plugin/?.lua;tests/plugin/?.lua;" .. package.path
local transport = require("transport")
local requests, reply = {}, nil
local function http(request) requests[#requests + 1] = request; return reply(request) end
local t = transport.new({url = "https://sync.example.org", token = "secret-token"}, http)

reply = function() return {status = 200, headers = {["Retry-After"] = "5", [1] = "ignored"}, body = "{}"} end
local response = t:get_config()
assert(response.status == 200 and response.headers["retry-after"] == "5" and response.body == "{}")
local request = requests[1]
assert(request.method == "GET" and request.url == "https://sync.example.org/api/v1/sync/config" and request.body == nil)
assert(request.headers["Authorization"] == "Bearer secret-token" and request.headers["Content-Type"] == nil)
assert(request.timeout.block == 5 and request.timeout.total == 30 and request.max_body == 1048576)

t:post_sync("{\"a\":1}")
request = requests[2]
assert(request.method == "POST" and request.url:match("/api/v1/sync$") and request.body == "{\"a\":1}"
    and request.headers["Content-Type"] == "application/json" and request.headers["Content-Length"] == "7")
t:create_upload("{}")
assert(requests[3].url:match("/api/v1/uploads$") and requests[3].method == "POST")
t:put_chunk("abc", 3, "bytes")
request = requests[4]
assert(request.method == "PUT" and request.url:match("/api/v1/uploads/abc/chunks/3$") and request.headers["Content-Type"] == "application/octet-stream")
t:commit("abc")
assert(requests[5].url:match("/api/v1/uploads/abc/commit$") and requests[5].body == "{}")

-- Failures never carry the token or the underlying message.
for _, failure in ipairs({
    function() error("boom secret-token") end, function() return nil end, function() return {error = "timeout secret-token"} end,
    function() return {status = "200"} end,
}) do
    reply = failure
    local result = t:get_config()
    assert(result.error == "network" and result.status == nil)
end
reply = function() return {status = 204} end
local empty = t:post_sync("x")
assert(empty.status == 204 and empty.body == "" and next(empty.headers) == nil)
assert(not pcall(transport.new, {url = "u"}, http) and not pcall(transport.new, {url = "u", token = "t"}, nil))
print("transport assertions passed")
