package.path = "plugin/?.lua;tests/plugin/?.lua;" .. package.path
local settings = require("settings")
local token = "AbC_123-xyz_AbC_123-xyz"
local function conf(url, extra) return '-- comment\n\nurl = "' .. url .. '"\ntoken = "' .. token .. '"\n' .. (extra or "") end

local ok = settings.parse(conf("https://sync.example.org/"))
assert(ok.url == "https://sync.example.org" and ok.token == token and ok.host == "sync.example.org" and ok.zoneinfo_dir == nil)
assert(settings.parse(conf("https://sync.example.org:8443/kindle/")).url == "https://sync.example.org:8443/kindle")
assert(settings.parse(conf("http://localhost:3000")).url == "http://localhost:3000")
assert(settings.parse(conf("http://127.0.0.1")).host == "127.0.0.1")
assert(settings.parse(conf("http://[::1]:8080")).host == "[::1]")
assert(settings.parse(conf("https://[::1]")).host == "[::1]")
assert(settings.parse(conf("https://a.example", 'zoneinfo_dir = "/usr/share/zoneinfo"\n')).zoneinfo_dir == "/usr/share/zoneinfo")
assert(settings.parse((conf("https://a.example"):gsub("\n", "\r\n"))).host == "a.example")

local function rejected(text)
    local value, reason = settings.parse(text)
    assert(value == nil and reason == "settings_invalid", tostring(text))
end
rejected(nil); rejected(("x"):rep(5000)); rejected("")
rejected(conf("http://sync.example.org"))              -- plain http only for loopback
rejected(conf("ftp://sync.example.org"))
rejected(conf("https://user:pw@sync.example.org"))
rejected(conf("https://sync.example.org:99999"))
rejected(conf("https://sync.example.org/path?q=1"))
rejected(conf("https://sync.example.org/a b"))
rejected(conf("https://"))
rejected(conf("https://sync.example.org/%00"))
rejected('url = "https://a.example"\n')                 -- missing token
rejected('token = "' .. token .. '"\n')                -- missing url
rejected(conf("https://a.example", 'url = "https://b.example"\n'))   -- duplicate key
rejected(conf("https://a.example", 'other = "x"\n'))                  -- unknown key
rejected(conf("https://a.example", 'os.execute("x")\n'))              -- not a setting line
rejected(conf("https://a.example", 'zoneinfo_dir = "relative"\n'))
rejected('url = "https://a.example"\ntoken = "short"\n')
rejected('url = "https://a.example"\ntoken = "' .. ("a"):rep(513) .. '"\n')
rejected('url = "https://a.example"\ntoken = "' .. token .. '+/"\n')

local read = {}
function read.file(path) return read[path] end
read["/cfg/" .. settings.FILE] = conf("https://a.example")
assert(settings.load(read.file, "/cfg").host == "a.example")
local missing, reason = settings.load(read.file, "/other")
assert(missing == nil and reason == "not_configured")
print("settings assertions passed")
