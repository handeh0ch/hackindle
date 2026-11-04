local allocation = require("allocation")
local M = {}
-- split/date_at are unverified reporting-zone adapters; null is the JSON
-- encoder's explicit null sentinel. No time or location is inferred here.
function M.build(sample, seconds, pieces, timing, profile, split, date_at, null)
    assert(null ~= nil, "JSON null sentinel required")
    local event = {event_id = sample.event_id, source_id = sample.source_id, session_id = sample.session_id,
        occurred_at = sample.occurred_at, type = "reading_segment", measurement_version = sample.measurement_version,
        native_seconds = null, native_record_id = null, provenance = null, timing_quality = "unavailable",
        allocation = {}, awake_windows = {}, native_anchor = null,
        volume_quality = "unavailable", volume_date = null, credited_characters = null, ranges = {}}
    if seconds ~= nil then
        assert(timing and sample.native_id and sample.provenance, "native timing evidence unavailable")
        event.native_seconds, event.native_record_id, event.provenance = seconds, sample.native_id, sample.provenance
        event.timing_quality = timing.quality
        if timing.quality == "observed_windows" then
            event.awake_windows = timing.windows
            event.allocation = allocation.windows(seconds, profile, timing.windows, split)
        else
            assert(timing.quality == "estimated_native_anchor" and timing.anchor, "invalid timing quality")
            event.native_anchor = timing.anchor
            event.allocation = allocation.anchor(seconds, profile, timing.anchor, date_at)
        end
    end
    if pieces then
        assert(type(sample.day) == "string", "volume date unavailable")
        event.volume_quality, event.volume_date, event.credited_characters = "measured", sample.day, 0
        for _, piece in ipairs(pieces) do
            assert(type(piece.characters) == "number" and piece.characters >= 0
                and piece.characters <= 9007199254740991 - event.credited_characters
                and piece.characters == math.floor(piece.characters), "invalid credited characters")
            event.credited_characters = event.credited_characters + piece.characters
            event.ranges[#event.ranges + 1] = {start = piece.first, ["end"] = piece.last, characters = piece.characters}
        end
    end
    return event
end
return M
