package.path = "projects/plugin/?.lua;" .. package.path
local segment = require("reading.segment")
local null = {}
local sample = {event_id="event", source_id="source", session_id="session", occurred_at="2026-01-01T00:00:00Z", day="2026-01-01", native_id="native", measurement_version="v1", provenance="native"}
local pieces = {{first="a", last="b", characters=3}}
local timing = {quality="estimated_native_anchor", anchor="2026-01-01T00:00:00Z"}
local function date_at() return "2026-01-01" end
local event = segment.build(sample, 5, pieces, timing, {}, nil, date_at, null)
assert(event.type == "reading_segment" and event.native_seconds == 5 and event.credited_characters == 3)
assert(event.ranges[1].start == "a" and event.ranges[1]["end"] == "b" and event.allocation[1].seconds == 5)
assert(event.native_anchor == timing.anchor and #event.awake_windows == 0)
event = segment.build(sample, nil, pieces, nil, {}, nil, date_at, null)
assert(event.timing_quality == "unavailable" and event.native_seconds == null and event.native_record_id == null and #event.allocation == 0 and event.credited_characters == 3)
event = segment.build(sample, 5, nil, timing, {}, nil, date_at, null)
assert(event.volume_quality == "unavailable" and event.credited_characters == null and event.volume_date == null and #event.ranges == 0)
print("segment assertions passed")
local observed = {quality="observed_windows",windows={{start="2026-01-01T00:00:00Z",["end"]="2026-01-01T00:01:00Z"}}}
event = segment.build(sample, 5, {}, observed, {}, function() return {{date="2026-01-01",weight=60}} end, nil, null)
assert(event.timing_quality == "observed_windows" and event.native_anchor == null and event.allocation[1].seconds == 5)
assert(event.credited_characters == 0 and #event.ranges == 0)
assert(not pcall(function() segment.build(sample, 1, pieces, nil, {}, nil, date_at, null) end))
