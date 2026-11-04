local json = require("wire_json")
local M = {}
local function locator(value)
    if value and value ~= json.null and value.type == "pdf" then json.array(value.boxes) end
end
local function encode(profile, seq, captured_at, kind, source, payload)
    return json.encode({schema_version = 1, instance_id = profile.instance_id, device_id = profile.device_id,
        reset_generation = profile.reset_generation, seq = seq, captured_at = captured_at,
        kind = kind, source_id = source, payload = payload})
end
function M.reading(profile, seq, captured_at, source, events)
    for _, event in ipairs(events) do
        if event.type == "reading_segment" then
            json.array(event.ranges); json.array(event.allocation); json.array(event.awake_windows)
            for _, range in ipairs(event.ranges) do locator(range.start); locator(range["end"]) end
        elseif event.type == "progress_sample" then locator(event.progress.position) end
    end
    return encode(profile, seq, captured_at, "reading_events", source, {events = json.array(events)})
end
function M.annotations(profile, seq, captured_at, source, version, annotations)
    for _, annotation in ipairs(annotations) do
        locator(annotation.start); locator(annotation["end"])
        local context = annotation.context
        if context and context ~= json.null and context.status == "ready" then json.array(context.selection_pages) end
    end
    return encode(profile, seq, captured_at, "source_snapshot", source,
        {annotations = {version = version, value = json.array(annotations)}})
end
function M.vocabulary(profile, seq, captured_at, snapshot)
    json.array(snapshot.words)
    return encode(profile, seq, captured_at, "vocabulary_snapshot", json.null, snapshot)
end
function M.legacy(profile, seq, captured_at, source, snapshot)
    json.array(snapshot.records)
    return encode(profile, seq, captured_at, "legacy_statistics", source, snapshot)
end
function M.source(profile, seq, captured_at, source, sections)
    if sections.metadata then
        local metadata = sections.metadata.value
        json.array(metadata.authors); json.array(metadata.identifiers)
    end
    if sections.progress then locator(sections.progress.value.position) end
    return encode(profile, seq, captured_at, "source_snapshot", source, sections)
end
return M
