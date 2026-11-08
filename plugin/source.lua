local state = require("state")
local identity = require("identity")
local utc = require("utc")
local M = {}
-- Both inputs must be successfully read values; nil leaves a section unchanged.
function M.snapshot(store, source_id, metadata, progress, build_packet, boundary, require_ack, codec, generation, reset_verified)
    identity.source(source_id)
    if metadata == nil and progress == nil then return nil end
    return store:transaction(function(tx)
        if tx:get("capture_generation")=="blocked" then
            local p=codec and require("profile").policy_tx(tx,codec)
            assert(p and p.baseline_required and p.generation==generation and generation>0
                and tx:get("source_ack_generation:"..source_id)==string.format("%.0f",generation)
                and (not progress or reset_verified==true), "source reset baseline pending")
        else state.assert_capture_enabled(tx) end
        local format=tx:get("source_format:"..source_id)
        if require_ack then
            if metadata then
                assert(not format or format==metadata.format, "source format changed")
                format=metadata.format
            else
                M.assert_known(tx,source_id,generation or 0)
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
        if require_ack and metadata then tx:put("source_format:"..source_id,format); tx:put("source_metadata_packet:"..source_id,packet) end
        tx:enqueue(seq, packet)
        return packet
    end)
end
function M.metadata_ack(store,codec,bytes)
    local ok,ack=pcall(require("codec").decode,bytes)
    if not ok or type(ack)~="table" or type(ack.source_id)~="string" then return false end
    local allowed={schema_version=true,instance_id=true,device_id=true,source_id=true,reset_generation=true,current_reset_generation=true,seq=true,kind=true,status=true,results=true}
    for key in pairs(ack) do if not allowed[key] then return false end end
    return store:transaction(function(tx)
        local p=require("profile").policy_tx(tx,codec); local bytes=tx:get("source_metadata_packet:"..ack.source_id)
        if p.generation~=0 or not bytes or not require("validator").validate(bytes) then return false end
        local packet=require("codec").decode(bytes)
        if ack.schema_version~=1 or ack.instance_id~=packet.instance_id or ack.device_id~=packet.device_id or ack.source_id~=packet.source_id
            or ack.seq~=packet.seq or ack.kind~="source_snapshot" or ack.reset_generation~=0 or ack.current_reset_generation~=0
            or (ack.status~="applied" and ack.status~="duplicate") or type(ack.results)~="table" then return false end
        for key in pairs(ack.results) do if not packet.payload[key] then return false end end
        for key in pairs(packet.payload) do if ack.results[key]~="applied" and ack.results[key]~="duplicate" and ack.results[key]~="stale" then return false end end
        local format=packet.payload.metadata and packet.payload.metadata.value.format
        if not format or tx:get("source_format:"..ack.source_id)~=format then return false end
        tx:put("source_ack:"..ack.source_id,format); return true
    end)
end
function M.check_locator(format, locator)
    assert(format=="pdf" or format=="epub" or format=="mobi", "source format unavailable")
    assert(type(locator)=="table" and ((locator.type=="pdf") == (format=="pdf")), "source format mismatch")
end
function M.assert_known(tx, source_id, generation)
    local format=tx:get("source_format:"..source_id)
    -- Generation 0: the metadata snapshot is queued before every later packet of
    -- the strictly ordered outbox, so the server has applied it by the time a
    -- reading event arrives; waiting for the acknowledgement would only discard
    -- everything read offline. After a reset the acknowledgement stays required.
    local known=generation==0 and format~=nil
        or generation>0 and tx:get("source_ack_generation:"..source_id)==string.format("%.0f",generation)
    assert(format and known, "source metadata pending")
    return format
end
function M.assert_reading(tx, source_id, packet)
    local envelope=require("codec").decode(packet)
    local format=M.assert_known(tx,source_id,envelope.reset_generation)
    for _,event in ipairs(envelope.payload.events) do
        if event.type=="reading_segment" then
            for _,range in ipairs(event.ranges) do M.check_locator(format,range.start); M.check_locator(format,range["end"]) end
        elseif event.type=="progress_sample" then M.check_locator(format,event.progress.position) end
    end
end
function M.reset_metadata(store,codec,generation,source_id,metadata,build)
    identity.source(source_id)
    return store:transaction(function(tx)
        local p=require("profile").policy_tx(tx,codec)
        assert(p.generation==generation and p.baseline_required and p.device_id, "source reset generation changed")
        local key="source_reset_metadata:"..source_id
        local saved=tx:get(key); local old=saved and codec.decode(saved)
        if old and old.generation==generation then return {seq=old.seq,packet=old.packet} end
        local format=tx:get("source_format:"..source_id)
        assert(not format or format==metadata.format, "source format changed")
        local version=state.next_counter(tx,"metadata_version:"..source_id)
        local seq=state.next_sequence(tx)
        require("wire_json").array(metadata.authors); require("wire_json").array(metadata.identifiers)
        local sections={metadata={version=version,value=metadata}}
        local expected=require("codec").encode(sections)
        local bytes=build(seq,sections)
        assert(require("validator").validate(bytes), "invalid source metadata packet")
        local packet=require("codec").decode(bytes)
        assert(packet.kind=="source_snapshot" and packet.instance_id==p.instance_id and packet.device_id==p.device_id
            and packet.source_id==source_id and packet.reset_generation==generation and packet.seq==seq
            and require("codec").encode(packet.payload)==expected, "source metadata packet mismatch")
        tx:put("source_format:"..source_id,metadata.format)
        tx:put(key,codec.encode({generation=generation,seq=seq,packet=bytes,format=metadata.format}))
        tx:enqueue(seq,bytes)
        return {seq=seq,packet=bytes}
    end)
end
function M.reset_metadata_ack(store,codec,bytes)
    local ok,ack=pcall(require("codec").decode,bytes)
    if not ok or type(ack)~="table" or type(ack.source_id)~="string" then return false end
    local allowed={schema_version=true,instance_id=true,device_id=true,source_id=true,reset_generation=true,current_reset_generation=true,seq=true,kind=true,status=true,results=true}
    for key in pairs(ack) do if not allowed[key] then return false end end
    return store:transaction(function(tx)
        local saved=tx:get("source_reset_metadata:"..ack.source_id); if not saved then return false end
        local old=codec.decode(saved); local p=require("profile").policy_tx(tx,codec)
        local packet=require("codec").decode(old.packet)
        if p.generation~=old.generation or ack.schema_version~=1 or ack.instance_id~=packet.instance_id
            or ack.device_id~=packet.device_id or ack.source_id~=packet.source_id or ack.seq~=packet.seq
            or ack.kind~="source_snapshot" or ack.reset_generation~=old.generation or ack.current_reset_generation~=old.generation
            or (ack.status~="applied" and ack.status~="duplicate") or type(ack.results)~="table"
            or (ack.results.metadata~="applied" and ack.results.metadata~="duplicate") then return false end
        for key in pairs(ack.results) do if key~="metadata" then return false end end
        tx:put("source_ack_generation:"..ack.source_id,string.format("%.0f",old.generation))
        return true
    end)
end
return M
