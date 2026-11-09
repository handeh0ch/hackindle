-- Binds the transport's http function to KOReader's socket stack. socket.http,
-- ssl.https, ltn12 and socketutil come from KOReader and its base submodule; their
-- behavior on the Kindle (including whether TLS certificates are verified) has
-- not been observed and is an I1 acceptance item.
local M = {}
function M.new(modules)
    modules = modules or {}
    local http = modules.http or require("socket.http")
    local https = modules.https or require("ssl.https")
    local ltn12 = modules.ltn12 or require("ltn12")
    local socketutil = modules.socketutil or require("socketutil")
    local clock = modules.clock or os.time
    return function(request)
        local parts, size = {}, 0
        local deadline = clock() + request.timeout.total
        -- socketutil only enforces the total limit through its own sinks, so check it here too.
        local function sink(chunk)
            if chunk == nil then return 1 end
            if clock() > deadline then return nil, "total timeout" end
            size = size + #chunk
            if size > request.max_body then return nil, "response too large" end
            parts[#parts + 1] = chunk
            return 1
        end
        -- A redirect would re-send the bearer token to whatever host answers: never follow one.
        local spec = {url = request.url, method = request.method, headers = request.headers, sink = sink, redirect = false}
        if request.body then spec.source = ltn12.source.string(request.body) end
        local client = request.url:sub(1, 6) == "https:" and https or http
        socketutil:set_timeout(request.timeout.block, request.timeout.total)
        local ran, accepted, code, headers = pcall(client.request, spec)
        pcall(function() socketutil:reset_timeout() end)
        if not ran or accepted == nil or type(code) ~= "number" then return {error = "network"} end
        return {status = code, headers = headers, body = table.concat(parts)}
    end
end
return M
