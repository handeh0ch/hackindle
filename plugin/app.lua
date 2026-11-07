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
function M.open(db, codec, config, device_id, validate_packet, zoneinfo, authenticated_ack)
    codec = codec or require("codec")
    assert(type(codec) == "table" and type(codec.encode) == "function" and type(codec.decode) == "function", "persistent codec unavailable")
    assert(validate_packet == nil or type(validate_packet) == "function", "invalid additional validator")
    assert(authenticated_ack == nil or type(authenticated_ack) == "function", "invalid acknowledgement verifier")
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
    function instance:source_metadata_ready(source_id)
        identity.source(source_id)
        return store:transaction(function(tx)
            local current=profile.policy_tx(tx,persistent)
            if current.generation~=config.reset_generation then return false end
            return pcall(source.assert_known,tx,source_id,current.generation)
        end)
    end
    local function trusted(bytes) return authenticated_ack and authenticated_ack(bytes)==true end
    function instance:source_metadata_ack(bytes) return trusted(bytes) and source.metadata_ack(store,persistent,bytes) or false end
    function instance:reset_source_metadata(source_id, metadata, captured_at)
        return source.reset_metadata(store,persistent,config.reset_generation,source_id,metadata,function(seq,sections)
            return checked(envelope.source(wire_profile,seq,captured_at,source_id,sections))
        end)
    end
    function instance:reset_source_metadata_ack(bytes)
        return trusted(bytes) and source.reset_metadata_ack(store,persistent,bytes) or false
    end
    function instance:begin_legacy_baseline(source_id)
        return require("legacy").begin_baseline(store,persistent,config.reset_generation,source_id)
    end
    function instance:legacy_baseline(source_id,value,baseline_id,ticket,captured_at)
        return require("legacy").baseline(store,persistent,config.reset_generation,source_id,value,baseline_id,device_id,ticket,function(seq,payload)
            return checked(envelope.legacy(wire_profile,seq,captured_at,source_id,payload))
        end)
    end
    function instance:legacy_ack(bytes) return trusted(bytes) and require("legacy").ack(store,persistent,bytes) or false end
    function instance:resume_legacy_baseline(source_id)
        return require("legacy").resume_baseline(store,persistent,config.reset_generation,source_id)
    end
    function instance:legacy_snapshot(source_id,value,captured_at)
        return require("legacy").after_baseline(store,persistent,config.reset_generation,source_id,value,function(seq,payload)
            return checked(envelope.legacy(wire_profile,seq,captured_at,source_id,payload))
        end)
    end
    function instance:annotation_baseline_ready(source_id)
        return profile.ready(store,persistent,"annotations",source_id)
    end
    function instance:begin_annotation_reset(source_id)
        return require("annotations").begin_reset(store,persistent,config.reset_generation,source_id)
    end
    function instance:annotation_reset_baseline(source_id,ticket,records)
        return require("annotations").reset_baseline(store,persistent,config.reset_generation,source_id,ticket,records)
    end
    function instance:annotation_reset_saved(source_id,key,event_id)
        return require("annotations").reset_saved(store,persistent,config.reset_generation,source_id,key,event_id)
    end
    function instance:begin_annotation_read(source_id)
        return require("annotations").begin_read(store,persistent,config.reset_generation,source_id)
    end
    function instance:annotation_reset_snapshot(source_id,ticket,records,allocate,extract,captured_at)
        return require("annotations").reset_snapshot(store,persistent,config.reset_generation,source_id,ticket,records,allocate,extract,function(seq,version,rows)
            return checked(envelope.annotations(wire_profile,seq,captured_at,source_id,version,rows))
        end)
    end
    function instance:reading_baseline_ready(source_id)
        local encoded=store:get("reading_baseline:"..identity.source(source_id))
        local baseline=encoded and persistent.decode(encoded)
        return baseline and baseline.generation==config.reset_generation or false
    end
    function instance:begin_reading_reset(source_id)
        identity.source(source_id)
        return capture.begin_reset(store,persistent,config.reset_generation,source_id)
    end
    function instance:reading_reset_baseline(source_id,ticket,value,compare)
        identity.source(source_id)
        return capture.reset_baseline(store,persistent,config.reset_generation,source_id,ticket,value,compare)
    end
    function instance:establish_reading_epoch(source_id,value)
        identity.source(source_id)
        return capture.establish_epoch(store,persistent,source_id,value)
    end
    function instance:annotations_snapshot(source_id,records,allocate,extract,captured_at)
        identity.source(source_id)
        return require("annotations").snapshot(store,persistent,source_id,records,allocate,extract,function(seq,version,rows)
            return checked(envelope.annotations(wire_profile,seq,captured_at,source_id,version,rows))
        end,function(tx,bytes)
            local format=source.assert_known(tx,source_id,config.reset_generation)
            for _,item in ipairs(require("codec").decode(bytes).payload.annotations.value) do
                source.check_locator(format,item.start); source.check_locator(format,item["end"])
            end
        end)
    end
    function instance:vocabulary_snapshot(read,captured_at)
        return require("vocabulary").snapshot(store,read,function(seq,payload)
            return checked(envelope.vocabulary(wire_profile,seq,captured_at,payload))
        end,persistent)
    end
    function instance:begin_vocabulary_reset()
        return require("reset").vocabulary_begin_baseline(store,persistent,config.reset_generation)
    end
    function instance:vocabulary_reset_baseline(ticket,records,captured_at)
        return require("reset").vocabulary_baseline(store,persistent,config.reset_generation,records,function(seq,payload)
            return checked(envelope.vocabulary(wire_profile,seq,captured_at,payload))
        end,ticket)
    end
    function instance:vocabulary_reset_ack(bytes)
        return trusted(bytes) and require("reset").vocabulary_ack(store,persistent,bytes) or false
    end
    function instance:vocabulary_reset_saved(item,event_id)
        return require("reset").vocabulary_saved(store,persistent,config.reset_generation,item,event_id)
    end
    function instance:begin_vocabulary_read()
        return require("reset").vocabulary_watermark(store,persistent,config.reset_generation)
    end
    function instance:vocabulary_reset_snapshot(ticket,records,captured_at)
        return require("reset").vocabulary_snapshot(store,persistent,config.reset_generation,records,ticket,function(seq,payload)
            return checked(envelope.vocabulary(wire_profile,seq,captured_at,payload))
        end)
    end
    function instance:legacy_initial(source_id,read,captured_at)
        identity.source(source_id)
        return require("legacy").snapshot(store,source_id,read,function(seq,payload)
            return checked(envelope.legacy(wire_profile,seq,captured_at,source_id,payload))
        end,function(tx) source.assert_known(tx,source_id,config.reset_generation) end)
    end
    function instance:legacy_native_records(source_id,connection,binding)
        identity.source(source_id)
        assert(type(binding)=="table" and binding.source_id==source_id, "native source mismatch")
        return require("koreader_statistics").legacy(connection,binding,function(instant)
            return timezone.date_at(reporting_profile,instant)
        end)
    end
    function instance:legacy_native_initial(source_id,connection,binding,captured_at)
        identity.source(source_id)
        assert(type(binding)=="table" and binding.source_id==source_id, "native source mismatch")
        return self:legacy_initial(source_id,function() return self:legacy_native_records(source_id,connection,binding) end,captured_at)
    end
    local function lifecycle_builder(at)
        return function(seq,source_id,events) return checked(envelope.reading(wire_profile,seq,at,source_id,events)) end
    end
    local function lifecycle_guard(tx,source_id,bytes) source.assert_reading(tx,source_id,bytes) end
    function instance:reading_native_seen(source_id,native_id)
        identity.source(source_id)
        return store:get(capture.native_key(source_id,native_id))~=nil
    end
    function instance:reading_context(source_id,at)
        identity.source(source_id)
        local encoded=store:get("lifecycle")
        local active=encoded and persistent.decode(encoded).active
        assert(active and active.source==source_id and type(active.session)=="string", "reading session unavailable")
        return {session_id=active.session,day=timezone.date_at(reporting_profile,at)}
    end
    function instance:session_open(source_id,cycle,at,uuid,reset_verified)
        identity.source(source_id)
        return require("sessions").open(store,persistent,source_id,cycle,at,uuid,lifecycle_builder(at),lifecycle_guard,{generation=config.reset_generation,verified=reset_verified})
    end
    function instance:session_close(at,uuid,reset_verified)
        return require("sessions").close(store,persistent,at,uuid,lifecycle_builder(at),lifecycle_guard,{generation=config.reset_generation,verified=reset_verified})
    end
    function instance:begin_cycle(at,uuid,reset_verified)
        return require("sessions").begin_cycle(store,persistent,at,uuid,lifecycle_builder(at),lifecycle_guard,{generation=config.reset_generation,verified=reset_verified})
    end
    function instance:finish_book(at,uuid,reset_verified)
        return require("sessions").finish(store,persistent,at,uuid,lifecycle_builder(at),lifecycle_guard,{generation=config.reset_generation,verified=reset_verified})
    end
    function instance:source_snapshot(source_id, metadata, progress, captured_at, boundary, reset_verified)
        return source.snapshot(store, source_id, metadata, progress, function(seq, sections)
            return checked(envelope.source(wire_profile, seq, captured_at, source_id, sections))
        end, boundary, true, persistent, config.reset_generation, reset_verified)
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
