local state = require("storage.state")
local M = {}
-- Legacy statistics stay separate from measured character and time events.
function M.snapshot(store, source, read, build_packet, guard_packet)
    assert(type(source) == "string" and #source == 64 and source:match("^[0-9a-f]+$"), "invalid source ID")
    local ok, records = pcall(read)
    if not ok or type(records) ~= "table" then return nil end
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local version = state.next_counter(tx, "legacy_version:" .. source)
        local seq = state.next_sequence(tx)
        local packet = build_packet(seq, {version = version, records = records})
        assert(type(packet) == "string", "packet encoding failed")
        if guard_packet then guard_packet(tx,packet) end
        tx:enqueue(seq, packet)
        return packet
    end)
end
-- Retain cumulative raw high-water marks so repeated resets subtract from raw,
-- not from the previous generation's already-subtracted live value.
function M.reconcile(data, records, reset)
    local seen = {}
    for _, record in ipairs(records) do
        assert(type(record.date) == "string" and not seen[record.date], "invalid legacy date")
        seen[record.date] = true
        for _, key in ipairs({"native_pages", "native_seconds"}) do
            local n = record[key]
            assert(type(n) == "number" and n >= 0 and n <= 9007199254740991 and n == math.floor(n), "invalid legacy counter")
        end
        local item = data[record.date] or {pages = 0, seconds = 0, baseline_pages = 0, baseline_seconds = 0}
        item.pages = math.max(item.pages, record.native_pages)
        item.seconds = math.max(item.seconds, record.native_seconds)
        data[record.date] = item
    end
    local dates = {}
    for date in pairs(data) do dates[#dates + 1] = date end
    table.sort(dates)
    local result = {}
    for _, date in ipairs(dates) do
        local item = data[date]
        if reset then item.baseline_pages, item.baseline_seconds = item.pages, item.seconds end
        result[#result + 1] = {date = date, native_pages = item.pages - item.baseline_pages,
            native_seconds = item.seconds - item.baseline_seconds}
    end
    return result
end

-- The adapter must provide a complete native read and evidence that its epoch
-- denotes a continuous counter lineage. No device adapter is verified yet.
local function observation(value)
    assert(type(value)=="table" and value.verified==true and type(value.epoch)=="string"
        and type(value.records)=="table", "native legacy lineage unavailable")
end
local function nonregressing(previous, records)
    local current={}; for _,r in ipairs(records) do current[r.date]=r end
    for _,r in ipairs(previous) do
        local now=current[r.date]
        assert(now and now.native_pages>=r.native_pages and now.native_seconds>=r.native_seconds, "legacy counter regressed")
    end
end
local function packet_check(bytes, p, source, generation, seq, expected)
    local codec = require("protocol.codec")
    assert(require("protocol.validator").validate(bytes), "invalid legacy packet")
    local packet=codec.decode(bytes)
    assert(packet.instance_id==p.instance_id and packet.device_id==p.device_id and packet.source_id==source
        and packet.reset_generation==generation and packet.seq==seq and packet.kind=="legacy_statistics"
        and codec.encode(packet.payload)==expected, "legacy packet identity mismatch")
end
function M.begin_baseline(store,codec,generation,source)
    return store:transaction(function(tx)
        local p=require("protocol.profile").policy_tx(tx,codec)
        assert(p.generation==generation, "legacy generation changed")
        if generation>0 then
            local encoded=tx:get("source_reset_metadata:"..source)
            local metadata=encoded and codec.decode(encoded)
            assert(metadata and metadata.generation==generation, "source metadata pending")
        end
        local ticket=state.next_counter(tx,"legacy_read_ticket")
        tx:put("legacy_pending_read:"..source,codec.encode({generation=generation,ticket=ticket}))
        return ticket
    end)
end
function M.baseline(store,codec,generation,source,value,baseline_id,device_id,ticket,build)
    if value==nil then return nil end
    observation(value)
    return store:transaction(function(tx)
        local p=require("protocol.profile").policy_tx(tx,codec)
        assert(p.generation==generation and p.device_id==device_id, "legacy generation changed")
        local pending=tx:get("legacy_pending_read:"..source)
        local read=pending and codec.decode(pending)
        assert(read and read.generation==generation and read.ticket==ticket, "legacy read ticket invalid")
        local key="legacy_barrier:"..source
        local saved=tx:get(key); local old=saved and codec.decode(saved)
        if old and old.generation==generation then
            assert(old.epoch==value.epoch, "legacy epoch changed")
            local ready=generation==0 or tx:get("source_ack_generation:"..source)==string.format("%.0f",generation)
            if ready and not old.queued then old.queued=true; tx:put(key,codec.encode(old)); tx:enqueue(old.seq,old.packet) end
            return {seq=old.seq,packet=old.packet,pending=not ready}
        end
        if old then assert(old.epoch==value.epoch, "legacy epoch changed"); nonregressing(old.records,value.records) end
        local version=state.next_counter(tx,"legacy_version:"..source)
        local seq=state.next_sequence(tx)
        local payload={mode="baseline",baseline_id=baseline_id,native_epoch=value.epoch,version=version,records=require("protocol.wire_json").array(value.records)}
        local expected=require("protocol.codec").encode(payload)
        local bytes=build(seq,payload); packet_check(bytes,p,source,generation,seq,expected)
        local ready=generation==0 or tx:get("source_ack_generation:"..source)==string.format("%.0f",generation)
        tx:put(key,codec.encode({generation=generation,epoch=value.epoch,id=baseline_id,seq=seq,packet=bytes,records=value.records,acknowledged=false,queued=ready}))
        if ready then tx:enqueue(seq,bytes) end
        return {seq=seq,packet=bytes,pending=not ready}
    end)
end
function M.resume_baseline(store,codec,generation,source)
    return store:transaction(function(tx)
        local p=require("protocol.profile").policy_tx(tx,codec)
        local key="legacy_barrier:"..source; local encoded=tx:get(key); local old=encoded and codec.decode(encoded)
        assert(old and old.generation==generation and p.generation==generation, "legacy baseline pending")
        local ready=generation==0 or tx:get("source_ack_generation:"..source)==string.format("%.0f",generation)
        if ready and not old.queued then old.queued=true; tx:put(key,codec.encode(old)); tx:enqueue(old.seq,old.packet) end
        return {seq=old.seq,packet=old.packet,pending=not ready}
    end)
end
function M.ack(store,codec,bytes)
    local ok,ack=pcall(require("protocol.codec").decode,bytes)
    if not ok or type(ack)~="table" or type(ack.source_id)~="string" then return false end
    local allowed={schema_version=true,instance_id=true,device_id=true,source_id=true,reset_generation=true,current_reset_generation=true,seq=true,kind=true,status=true,results=true}
    for key in pairs(ack) do if not allowed[key] then return false end end
    return store:transaction(function(tx)
        local key="legacy_barrier:"..ack.source_id
        local saved=tx:get(key); if not saved then return false end
        local barrier=codec.decode(saved); local p=require("protocol.profile").policy_tx(tx,codec)
        local packet=require("protocol.codec").decode(barrier.packet)
        if not barrier.queued or p.generation~=barrier.generation or ack.schema_version~=1 or ack.instance_id~=packet.instance_id
            or ack.device_id~=packet.device_id or ack.source_id~=packet.source_id or ack.seq~=packet.seq
            or ack.kind~="legacy_statistics" or ack.reset_generation~=barrier.generation
            or ack.current_reset_generation~=barrier.generation or (ack.status~="applied" and ack.status~="duplicate")
            or type(ack.results)~="table" or (ack.results.legacy_statistics~="applied" and ack.results.legacy_statistics~="duplicate") then return false end
        for k in pairs(ack.results) do if k~="legacy_statistics" then return false end end
        barrier.acknowledged=true; tx:put(key,codec.encode(barrier)); return true
    end)
end
function M.after_baseline(store,codec,generation,source,value,build)
    observation(value)
    return store:transaction(function(tx)
        local p=require("protocol.profile").policy_tx(tx,codec)
        local key="legacy_barrier:"..source; local saved=tx:get(key); local old=saved and codec.decode(saved)
        assert(old and old.generation==generation and p.generation==generation and old.acknowledged, "legacy baseline pending")
        assert(old.epoch==value.epoch, "legacy epoch changed")
        nonregressing(old.records,value.records)
        -- Unchanged statistics are not queued again on every suspend and close.
        if require("protocol.codec").encode(old.records)==require("protocol.codec").encode(value.records) then return true end
        local version=state.next_counter(tx,"legacy_version:"..source); local seq=state.next_sequence(tx)
        local payload={mode="snapshot",baseline_id=old.id,native_epoch=old.epoch,version=version,records=require("protocol.wire_json").array(value.records)}
        local expected=require("protocol.codec").encode(payload)
        local bytes=build(seq,payload); packet_check(bytes,p,source,generation,seq,expected)
        old.records=value.records; tx:put(key,codec.encode(old)); tx:enqueue(seq,bytes)
        return bytes
    end)
end
return M
