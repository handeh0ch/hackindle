package.path = "projects/plugin/?.lua;" .. package.path
local allocation = require("time.allocation")
local windows = {{start="2026-03-08T04:00:00Z", finish="2026-03-09T05:00:00Z"}}
local function split(profile, observed)
    assert(profile.reporting_timezone == "Synthetic/DST" and observed == windows)
    return {{date="2026-03-07", weight=1}, {date="2026-03-08", weight=23}, {date="2026-03-09", weight=1}}
end
local result = allocation.windows(7, {reporting_timezone="Synthetic/DST"}, windows, split)
assert(result[1].seconds == 0 and result[2].seconds == 7 and result[3].seconds == 0)
local tied = allocation.weights(1, {{date="2026-01-01",weight=1},{date="2026-01-02",weight=1}})
assert(tied[1].seconds == 1 and tied[2].seconds == 0)
local big = allocation.weights(9007199254740991, {{date="2026-01-01",weight=4503599627370495},{date="2026-01-02",weight=4503599627370496}})
assert(big[1].seconds == 4503599627370495 and big[2].seconds == 4503599627370496)
assert(not pcall(function() allocation.windows(10, {}, windows, function() return nil end) end))
local wide=allocation.weights(3, {{date="2026-01-01",weight=9007199254740991},{date="2026-01-02",weight=1}})
assert(wide[1].seconds==3 and wide[2].seconds==0)
assert(not pcall(function() allocation.weights(3, {{date="2026-01-02",weight=1},{date="2026-01-01",weight=1}}) end))
print("allocation assertions passed")
local anchored = allocation.anchor(0, {reporting_timezone="Synthetic/DST"}, "2026-03-08T00:00:00Z", function(profile, instant)
    assert(profile.reporting_timezone == "Synthetic/DST" and instant == "2026-03-08T00:00:00Z")
    return "2026-03-07"
end)
assert(anchored[1].date == "2026-03-07" and anchored[1].seconds == 0)
assert(not pcall(function() allocation.anchor(1, {}, "2026-01-01T00:00:00Z", function() return nil end) end))
assert(not pcall(function() allocation.weights(1, {{date="2025-02-29",weight=1}}) end))
assert(allocation.weights(1, {{date="2024-02-29",weight=1}})[1].seconds == 1)
assert(not pcall(function() allocation.weights(1, {{date="0000-01-01",weight=1}}) end))
