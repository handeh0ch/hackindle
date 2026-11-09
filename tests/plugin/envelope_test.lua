package.path = "projects/plugin/?.lua;" .. package.path
local envelope = require("protocol.envelope")
local profile = {instance_id="48bc0344-efad-4c68-adb6-dc0f0ba57276",device_id="a92e58b4-851b-467b-a5ad-1eaaccc84c61",reset_generation=0}
local body = envelope.reading(profile, 1, "2026-01-01T00:00:00Z", ("a"):rep(64), {})
assert(body:match('"events":%[%]'))
print("envelope assertions passed")
local j = require("protocol.wire_json")
local source = ("a"):rep(64)
local pdf = {type="pdf",page=1,boxes={},geometry_version=j.null}
local event = {type="progress_sample",progress={position=pdf}}
assert(envelope.reading(profile,2,"2026-01-01T00:00:00Z",source,{event}):match('"boxes":%[%]'))
local segment = {type="reading_segment",ranges={{start=pdf,["end"]=pdf,characters=1}},allocation={},awake_windows={}}
assert(envelope.reading(profile,3,"2026-01-01T00:00:00Z",source,{segment}):match('"allocation":%[%]'))
local a = {start=pdf,["end"]=j.null,context={status="ready",selection_pages={}}}
assert(envelope.annotations(profile,4,"2026-01-01T00:00:00Z",source,1,{a}):match('"selection_pages":%[%]'))
assert(envelope.vocabulary(profile,5,"2026-01-01T00:00:00Z",{version=1,words={}}):match('"words":%[%]'))
assert(envelope.legacy(profile,6,"2026-01-01T00:00:00Z",source,{version=1,records={}}):match('"records":%[%]'))
local sections = {metadata={version=1,value={format="epub",title="s",authors={},language=j.null,identifiers={}}},progress={version=1,value={position=pdf}}}
local projected = envelope.source(profile,7,"2026-01-01T00:00:00Z",source,sections)
assert(projected:match('"authors":%[%]') and projected:match('"identifiers":%[%]') and projected:match('"boxes":%[%]'))
