-- Builds device requests from persisted bytes only. The injected http function
-- performs one request and returns {status, headers, body}, or {error=...} on a
-- network failure. No retry logic and no network state decisions live here.
local M = {}
local TIMEOUT = {block = 5, total = 30}
local MAX_BODY = 1048576

-- The token is a credential: it is only placed in the Authorization header and
-- never in an error value or a log line.
function M.new(settings, http)
    assert(type(settings) == "table" and type(settings.url) == "string" and type(settings.token) == "string", "transport settings unavailable")
    assert(type(http) == "function", "http function unavailable")
    local transport = {}
    local function call(method, path, body, content_type)
        local headers = {["Authorization"] = "Bearer " .. settings.token, ["Accept"] = "application/json"}
        if body ~= nil then
            headers["Content-Type"] = content_type
            headers["Content-Length"] = tostring(#body)
        end
        local ok, response = pcall(http, {method = method, url = settings.url .. path, headers = headers,
            body = body, timeout = TIMEOUT, max_body = MAX_BODY})
        if not ok or type(response) ~= "table" or response.error or type(response.status) ~= "number" then return {error = "network"} end
        local normalized = {}
        for name, value in pairs(type(response.headers) == "table" and response.headers or {}) do
            if type(name) == "string" then normalized[name:lower()] = value end
        end
        return {status = response.status, headers = normalized, body = type(response.body) == "string" and response.body or ""}
    end
    function transport:get_config() return call("GET", "/api/v1/sync/config") end
    function transport:post_sync(bytes) return call("POST", "/api/v1/sync", bytes, "application/json") end
    function transport:create_upload(manifest) return call("POST", "/api/v1/uploads", manifest, "application/json") end
    function transport:put_chunk(id, index, bytes)
        return call("PUT", "/api/v1/uploads/" .. id .. "/chunks/" .. string.format("%d", index), bytes, "application/octet-stream")
    end
    function transport:commit(id) return call("POST", "/api/v1/uploads/" .. id .. "/commit", "{}", "application/json") end
    return transport
end
return M
