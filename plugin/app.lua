local state = require("state")
local profile = require("profile")
local source = require("source")
local envelope = require("envelope")
local capture = require("capture")
local segment = require("segment")
local identity = require("identity")
local json = require("wire_json")
local M = {}
-- config must come from the authenticated sync profile. The injected DB and
-- codec must persist across restarts; their device implementations are unverified.
function M.open(db, codec, config, device_id, validate_packet, zoneinfo)
    codec = codec or require("codec")
    assert(type(codec) == "table" and type(codec.encode) == "function" and type(codec.decode) == "function", "persistent codec unavailable")
    assert(validate_packet == nil or type(validate_packet) == "function", "invalid additional validator")
    assert(type(device_id) == "string" and device_id ~= "", "device identity unavailable")
    local persistent = {}
    function persistent.encode(value)
        local encoded = codec.encode(value)
        assert(type(encoded) == "string", "persistent codec must return bytes")
        return encoded
    end
    function persistent.decode(value)
        local decoded = codec.decode(value)
        assert(type(decoded) == "table", "persistent codec returned invalid state")
        return decoded
    end
    local store = state.open(db)
    local status = profile.accept(store, persistent, config, device_id)
    assert(type(zoneinfo) == "table", "timezone data unavailable")
    local tzif = require("tzif")
    local timezone = tzif.adapter(config.reporting_timezone, tzif.provider(zoneinfo.root, zoneinfo.read_file))
    local wire_profile = {instance_id = config.instance_id, device_id = device_id, reset_generation = config.reset_generation}
    local reporting_profile = {reporting_timezone = config.reporting_timezone, characters_per_page = config.characters_per_page}
    local function checked(packet)
        assert(require("validator").validate(packet) == true and (not validate_packet or validate_packet(packet) == true), "packet validation failed")
        return packet
    end
    local instance = {profile_status = status}
    function instance:source_snapshot(source_id, metadata, progress, captured_at, boundary)
        return source.snapshot(store, source_id, metadata, progress, function(seq, sections)
            return checked(envelope.source(wire_profile, seq, captured_at, source_id, sections))
        end, boundary, true)
    end
    function instance:reading_sample(sample, adapter, captured_at)
        identity.source(sample.source)
        assert(type(sample.event_id) == "string" and sample.event_id ~= "", "event identity unavailable")
        assert(sample.source_id == sample.source, "source identity mismatch")
        assert(type(adapter.compare) == "function" and type(adapter.measure) == "function"
            and type(adapter.locator) == "function", "reading adapter unavailable")
        return capture.record(store, persistent, adapter.compare, adapter.measure, sample, function(seq, seconds, pieces, timing)
            local ranges
            if pieces then
                ranges = {}
                for _, piece in ipairs(pieces) do
                    ranges[#ranges + 1] = {first = adapter.locator(piece.first), last = adapter.locator(piece.last), characters = piece.characters}
                end
            end
            local event = segment.build(sample, seconds, ranges, timing, reporting_profile, timezone.split, timezone.date_at, json.null)
            assert(timezone.verify_reporting(event, reporting_profile) == true,
                "reporting timezone validation unavailable")
            return checked(envelope.reading(wire_profile, seq, captured_at, sample.source, {event}))
        end, function(tx, packet) source.assert_reading(tx, sample.source, packet) end)
    end
    return instance
end
return M
