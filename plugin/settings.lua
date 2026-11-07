-- Owner-placed connection settings. The plugin only reads this file: the token is
-- never typed on the device and never written, so a crash cannot truncate it.
-- The format is plain `key = "value"` lines; it is parsed, never executed.
local M = {}
M.FILE = "kindle_sync.conf"
local MAX_BYTES = 4096
local KEYS = {url = true, token = true, zoneinfo_dir = true}
local LOOPBACK = {["localhost"] = true, ["127.0.0.1"] = true, ["[::1]"] = true}

local function origin(url)
    local scheme, authority, path = url:match("^(https?)://([^/?#%s]+)(.*)$")
    if not scheme or authority:find("@", 1, true) then return nil end
    local host, port = authority:match("^(%[[%x:]+%]):(%d+)$")
    if not host then host, port = authority:match("^([%w%.%-]+):(%d+)$") end
    if not host then host = authority:match("^(%[[%x:]+%])$") or authority:match("^([%w%.%-]+)$") end
    if not host or (port and tonumber(port) > 65535) then return nil end
    if scheme == "http" and not LOOPBACK[host] then return nil end
    path = path:gsub("/+$", "")
    if path ~= "" and not path:match("^/[%w%-%._~/]*$") then return nil end
    return scheme .. "://" .. authority .. path, host
end

-- Returns {url, token, host, zoneinfo_dir} or nil plus a short reason code.
function M.parse(text)
    if type(text) ~= "string" or #text > MAX_BYTES then return nil, "settings_invalid" end
    local values = {}
    for line in (text .. "\n"):gmatch("([^\r\n]*)\r?\n") do
        if not line:match("^%s*$") and not line:match("^%s*%-%-") then
            local key, value = line:match('^%s*([%a_]+)%s*=%s*"([^"\\]*)"%s*$')
            if not key or not KEYS[key] or values[key] ~= nil then return nil, "settings_invalid" end
            values[key] = value
        end
    end
    local url, host = origin(values.url or "")
    if not url then return nil, "settings_invalid" end
    local token = values.token
    if not token or #token < 16 or #token > 512 or not token:match("^[A-Za-z0-9_%-]+$") then return nil, "settings_invalid" end
    if values.zoneinfo_dir ~= nil and not values.zoneinfo_dir:match("^/[%w%._%-/]*$") then return nil, "settings_invalid" end
    return {url = url, token = token, host = host, zoneinfo_dir = values.zoneinfo_dir}
end

function M.load(read_file, directory)
    local text = read_file(directory .. "/" .. M.FILE)
    if text == nil then return nil, "not_configured" end
    return M.parse(text)
end
return M
