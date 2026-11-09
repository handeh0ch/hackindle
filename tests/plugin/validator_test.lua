package.path = "projects/plugin/?.lua;" .. package.path
local validator = require("protocol.validator")
local payload = '{"schema_version":1,"instance_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276","device_id":"a92e58b4-851b-467b-a5ad-1eaaccc84c61","reset_generation":0,"seq":1,"captured_at":"2026-01-01T00:00:00Z","kind":"source_snapshot","source_id":"'..string.rep("a",64)..'","payload":{"metadata":{"version":1,"value":{"format":"epub","title":"Synthetic","authors":[],"language":null,"identifiers":[]}}}}'
assert(validator.validate(payload))
assert(not validator.validate(payload:gsub('"seq":1','"seq":0')))
assert(not validator.validate(payload:gsub('2026%-01%-01','2025-02-29')))
assert(not validator.validate(payload:gsub('"title":"Synthetic"','"title":"Synthetic","extra":true')))
assert(not validator.validate('{"kind":"unimplemented"}'))
print("validator assertions passed")
local reading = '{"schema_version":1,"instance_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276","device_id":"a92e58b4-851b-467b-a5ad-1eaaccc84c61","reset_generation":0,"seq":1,"captured_at":"2026-01-01T00:00:00Z","kind":"reading_events","source_id":"'..string.rep("a",64)..'","payload":{"events":[{"event_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276","source_id":"'..string.rep("a",64)..'","session_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276","occurred_at":"2026-01-01T00:00:00Z","type":"session_started","cycle_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276"}]}}'
assert(validator.validate(reading))
assert(not validator.validate(reading:gsub('"cycle_id"','"bad_id"')))
local vocab = '{"schema_version":1,"instance_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276","device_id":"a92e58b4-851b-467b-a5ad-1eaaccc84c61","reset_generation":0,"seq":1,"captured_at":"2026-01-01T00:00:00Z","kind":"vocabulary_snapshot","source_id":null,"payload":{"version":1,"words":[]}}'
assert(validator.validate(vocab))
local tagged = vocab:gsub('vocabulary_snapshot','legacy_statistics'):gsub('"source_id":null','"source_id":"'..string.rep('a',64)..'"'):gsub('"words":%[%]','"mode":"baseline","baseline_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276","native_epoch":"a92e58b4-851b-467b-a5ad-1eaaccc84c61","records":[]')
assert(validator.validate(tagged))
assert(not validator.validate(tagged:gsub(',"native_epoch":"[^"]+"','')))
assert(not validator.validate(vocab:gsub('"words":%[%]','"words":{}')))
local note = payload:gsub('"metadata":%{"version":1,"value":%{"format":"epub","title":"Synthetic","authors":%[%],"language":null,"identifiers":%[%]%}%}', '"annotations":{"version":1,"value":[{"annotation_id":"48bc0344-efad-4c68-adb6-dc0f0ba57276","kind":"highlight","start":{"type":"xpointer","value":"a"},"end":{"type":"xpointer","value":"b"},"quote":"x","note":"","chapter":null,"native_timestamp":null,"context":{"status":"pending","reason":"later"}}]}')
assert(validator.validate(note))
assert(not validator.validate(note:gsub('"reason":"later"','"reason":""')))
local too_large = payload:gsub('"title":"Synthetic"','"title":"'..string.rep('x',16777216)..'"')
assert(not validator.validate(too_large))
assert(not validator.validate(payload .. string.char(0xC0,0xAF)))
assert(validator.validate(payload:gsub('"title":"Synthetic"','"title":"é🙂"')))
assert(not validator.validate(payload:gsub('"title":"Synthetic"','"title":"'..string.char(0xC0,0xAF)..'"')))
assert(validator.validate(payload:gsub('"seq":1','"seq":1e0')))
assert(not validator.validate(payload:gsub('"seq":1','"seq":9007199254740992')))
assert(not validator.validate(payload:gsub('"seq":1','"seq":1.5')))
assert(validator.validate(payload:gsub('2026%-01%-01T00:00:00Z','0001-01-01T00:00:00.000000001Z')))
assert(not validator.validate(payload:gsub('2026%-01%-01T00:00:00Z','0000-01-01T00:00:00Z')))
assert(not validator.validate(payload:gsub('2026%-01%-01T00:00:00Z','2026-01-01T00:00:60Z')))
local codec = require("protocol.codec")
local f=assert(io.open("contracts/examples/synthetic.json","rb")); local fixtures=codec.decode(f:read("*a")); f:close()
for _, item in ipairs(fixtures.envelopes) do assert(validator.validate(codec.encode(item))) end
local function altered(item, edit)
    local copy=codec.decode(codec.encode(item)); edit(copy); return validator.validate(codec.encode(copy))
end
for _, item in ipairs(fixtures.envelopes) do
    if item.kind == "reading_events" then
        assert(not altered(item,function(x) x.payload.events[1].source_id=string.rep("b",64) end))
        assert(not altered(item,function(x) x.payload.events[#x.payload.events+1]=x.payload.events[1] end))
        for i,e in ipairs(item.payload.events) do
            if e.type == "reading_segment" then
                assert(not altered(item,function(x) x.payload.events[i].timing_quality="bad" end))
                assert(not altered(item,function(x) x.payload.events[i].volume_quality="bad" end))
                assert(not altered(item,function(x) x.payload.events[i].credited_characters=999999 end))
            end
        end
    elseif item.kind == "vocabulary_snapshot" then
        assert(not altered(item,function(x) x.source_id=string.rep("a",64) end))
    elseif item.kind == "legacy_statistics" then
        assert(not altered(item,function(x) x.payload.records[#x.payload.records+1]=x.payload.records[1] end))
    elseif item.kind == "source_snapshot" and item.payload.annotations and #item.payload.annotations.value > 0 then
        assert(not altered(item,function(x) x.payload.annotations.value[#x.payload.annotations.value+1]=x.payload.annotations.value[1] end))
        assert(not altered(item,function(x) x.payload.annotations.value[1].context={status="pending",reason=""} end))
    end
end
assert(not validator.validate(payload:gsub('"metadata":%{', '"metadata":false,"ignored":{')))
local false_metadata=payload:gsub('"metadata":%{"version":1,"value":%{"format":"epub","title":"Synthetic","authors":%[%],"language":null,"identifiers":%[%]%}%}', '"metadata":false')
assert(not validator.validate(false_metadata))
