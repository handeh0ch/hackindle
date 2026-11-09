package.path = "projects/plugin/?.lua;" .. package.path
local cover = require("snapshots.cover")
local jpeg = "\255\216\255" .. ("x"):rep(10)
local data, mime = cover.prepare(function() return jpeg end)
assert(data == jpeg and mime == "image/jpeg")
local webp = "RIFF" .. string.rep("\0",4) .. "WEBP" .. "x"
data, mime = cover.prepare(function() return webp end)
assert(data == webp and mime == "image/webp")
assert(cover.prepare(function() return nil end) == nil)
assert(cover.prepare(function() error("unavailable") end) == nil)
assert(cover.prepare(function() return "not a cover" end) == nil)
assert(cover.prepare(function() return jpeg .. string.rep("x",65536) end) == nil)
print("cover assertions passed")
