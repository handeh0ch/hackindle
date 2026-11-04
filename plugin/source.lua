local state = require("state")
local identity = require("identity")
local utc = require("utc")
local M = {}
-- Both inputs must be successfully read values; nil leaves a section unchanged.
function M.snapshot(store, source_id, metadata, progress, build_packet, boundary, require_ack)
    identity.source(source_id)
    if metadata == nil and progress == nil then return nil end
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local format=tx:get("source_format:"..source_id)
        if require_ack then
            if metadata then
                assert(not format or format==metadata.format, "source format changed")
                format=metadata.format
            else
                assert(format and tx:get("source_ack:"..source_id)==format, "source metadata acknowledgement pending")
            end
            if progress then M.check_locator(format,progress.position) end
        end
        local sections = {}
        local progress_key = "progress_time:" .. source_id
        if progress and not utc.due(progress.observed_at, tx:get(progress_key), boundary == true) then progress = nil end
        if metadata == nil and progress == nil then return nil end
        if metadata ~= nil then
            sections.metadata = {version = state.next_counter(tx, "metadata_version:" .. source_id), value = metadata}
        end
        if progress ~= nil then
            sections.progress = {version = state.next_counter(tx, "progress_version:" .. source_id), value = progress}
            tx:put(progress_key, progress.observed_at)
        end
        local seq = state.next_sequence(tx)
        local packet = build_packet(seq, sections)
        assert(type(packet) == "string", "packet encoding failed")
        if require_ack and metadata then tx:put("source_format:"..source_id,format) end
        tx:enqueue(seq, packet)
        return packet
    end)
end
function M.check_locator(format, locator)
    assert(format=="pdf" or format=="epub" or format=="mobi", "source format unavailable")
    assert(type(locator)=="table" and ((locator.type=="pdf") == (format=="pdf")), "source format mismatch")
end
function M.assert_reading(tx, source_id, packet)
    local format=tx:get("source_format:"..source_id)
    assert(format and tx:get("source_ack:"..source_id)==format, "source metadata acknowledgement pending")
    local envelope=require("codec").decode(packet)
    for _,event in ipairs(envelope.payload.events) do
        if event.type=="reading_segment" then
            for _,range in ipairs(event.ranges) do M.check_locator(format,range.start); M.check_locator(format,range["end"]) end
        elseif event.type=="progress_sample" then M.check_locator(format,event.progress.position) end
    end
end
return M
