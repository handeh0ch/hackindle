local reading = require("reading")
local state = require("state")
local M = {}
-- Native record IDs and cumulative finalized credit are unverified adapter inputs.
-- An unavailable observation needs its own stable identity for replay safety.
function M.record(store, codec, compare, measure, sample, build_packet, guard_packet)
    local unavailable = sample.seconds == nil
    local missing_volume = sample.first == nil and sample.last == nil
    local needs_identity = unavailable or missing_volume
    if needs_identity then
        if type(sample.observation_id) ~= "string" or sample.observation_id == "" then return nil end
    end
    if not unavailable then
        assert(type(sample.native_id) == "string" and sample.native_id ~= "", "native identity unavailable")
        assert(type(sample.seconds) == "number" and sample.seconds >= 0
            and sample.seconds <= 9007199254740991 and sample.seconds == math.floor(sample.seconds), "invalid native credit")
    end
    return store:transaction(function(tx)
        if tx:get("capture_generation")=="blocked" then
            local p=require("profile").policy_tx(tx,codec)
            local encoded=tx:get("reading_baseline:"..sample.source); local baseline=encoded and codec.decode(encoded)
            assert(baseline and baseline.generation==p.generation and sample.reset_verified==true
                and sample.native_epoch==baseline.epoch and tx:get("source_ack_generation:"..sample.source)==string.format("%.0f",p.generation), "reading reset baseline pending")
        else
            state.assert_capture_enabled(tx)
            local encoded=tx:get("reading_baseline:"..sample.source); local baseline=encoded and codec.decode(encoded)
            if baseline then assert(sample.reset_verified==true and sample.native_epoch==baseline.epoch, "reading native epoch unavailable") end
        end
        local serialized = tx:get("reading")
        local data = serialized and codec.decode(serialized) or {days = {}, native = {}, unavailable = {}}
        data.unavailable = data.unavailable or {}
        data.native[sample.source] = data.native[sample.source] or {}
        data.unavailable[sample.source] = data.unavailable[sample.source] or {}
        if needs_identity and data.unavailable[sample.source][sample.observation_id] then return nil end
        local delta
        if not unavailable then
            local previous = data.native[sample.source][sample.native_id] or 0
            assert(sample.seconds >= previous, "native credit regressed; reconciliation required")
            delta = sample.seconds - previous
        end
        local ledger = reading.new(compare, measure, data.days)
        local pieces
        if sample.first ~= nil and sample.last ~= nil then
            pieces = ledger:credit(sample.source, sample.day, sample.first, sample.last)
        else
            assert(sample.first == nil and sample.last == nil, "incomplete visible range")
        end
        if not unavailable and delta == 0 and pieces and #pieces == 0 then return nil end
        if not unavailable then
            local timing = sample.timing
            assert(type(timing) == "table" and timing.from == sample.seconds - delta and timing.to == sample.seconds,
                "delta-specific native chronology unavailable")
            assert((timing.quality == "estimated_native_anchor" and type(timing.anchor) == "string" and timing.anchor ~= "")
                or (timing.quality == "observed_windows" and type(timing.windows) == "table" and #timing.windows > 0),
                "delta-specific native chronology unavailable")
        end
        if sample.event_id ~= nil then state.claim_event(tx, sample.event_id) end
        local seq = state.next_sequence(tx)
        local packet = build_packet(seq, delta, pieces, not unavailable and sample.timing or nil)
        assert(type(packet) == "string", "packet encoding failed")
        if guard_packet then guard_packet(tx, packet) end
        if needs_identity then data.unavailable[sample.source][sample.observation_id] = true end
        if not unavailable then data.native[sample.source][sample.native_id] = sample.seconds end
        tx:put("reading", codec.encode(data))
        tx:enqueue(seq, packet)
        return packet
    end)
end

function M.establish_epoch(store,codec,source,value)
    assert(type(value)=="table" and value.verified==true and type(value.epoch)=="string" and value.epoch~="", "reading native epoch unavailable")
    return store:transaction(function(tx)
        state.assert_capture_enabled(tx)
        local key="reading_baseline:"..source; local saved=tx:get(key); local prior=saved and codec.decode(saved)
        if prior then assert(prior.generation==0 and prior.epoch==value.epoch,"reading native epoch changed"); return true end
        local serialized=tx:get("reading"); local data=serialized and codec.decode(serialized)
        local previous=data and data.native and data.native[source] or {}
        assert(next(previous)==nil, "reading native epoch unknown")
        tx:put(key,codec.encode({generation=0,epoch=value.epoch})); return true
    end)
end

function M.begin_reset(store,codec,generation,source)
    return store:transaction(function(tx)
        local p=require("profile").policy_tx(tx,codec)
        assert(p.baseline_required and p.generation==generation, "reading reset generation changed")
        local ticket=state.next_counter(tx,"reading_reset_ticket")
        tx:put("reading_reset_ticket:"..source,codec.encode({generation=generation,ticket=ticket}))
        return ticket
    end)
end
-- Inputs must be a complete native counter set and complete already-viewed
-- ranges, under one verified native epoch. Device evidence is still pending.
function M.reset_baseline(store,codec,generation,source,ticket,value,compare)
    if value==nil then return nil end
    assert(type(value)=="table" and value.verified==true and type(value.epoch)=="string" and value.epoch~=""
        and type(value.native)=="table" and type(value.ranges)=="table" and type(compare)=="function", "reading baseline unavailable")
    for _,list in ipairs({value.native,value.ranges}) do
        local count=0
        for key in pairs(list) do assert(type(key)=="number" and key>=1 and key==math.floor(key), "incomplete reading baseline"); count=count+1 end
        for i=1,count do assert(list[i]~=nil, "incomplete reading baseline") end
    end
    return store:transaction(function(tx)
        local p=require("profile").policy_tx(tx,codec); local issued=tx:get("reading_reset_ticket:"..source)
        issued=issued and codec.decode(issued)
        assert(p.baseline_required and p.generation==generation and issued and issued.generation==generation and issued.ticket==ticket, "reading baseline ticket invalid")
        local prior=tx:get("reading_baseline:"..source); prior=prior and codec.decode(prior)
        assert(not prior or prior.generation~=generation, "reading baseline already captured")
        assert(not prior or prior.epoch==value.epoch, "reading native epoch changed")
        local serialized=tx:get("reading"); local data=serialized and codec.decode(serialized) or {days={},native={},unavailable={}}
        data.native=data.native or {}; data.days=data.days or {}; data.unavailable=data.unavailable or {}
        local previous=data.native[source] or {}
        assert(prior or next(previous)==nil, "reading native epoch unknown")
        local seen={}
        for _,item in ipairs(value.native) do
            assert(type(item.id)=="string" and item.id~="" and not seen[item.id] and type(item.seconds)=="number" and item.seconds>=0
                and item.seconds<=9007199254740991 and item.seconds==math.floor(item.seconds), "invalid native baseline")
            assert(not previous[item.id] or item.seconds>=previous[item.id], "reading native counter regressed")
            seen[item.id]=item.seconds
        end
        for id in pairs(previous) do assert(seen[id]~=nil, "reading native record missing") end
        data.native[source]=seen
        local ledger=reading.new(compare,function() return 0 end,data.days)
        for _,range in ipairs(value.ranges) do
            assert(type(range.day)=="string" and #range.day==10 and pcall(require("utc").due,range.day.."T00:00:00Z",nil,false), "invalid baseline date")
            ledger:credit(source,range.day,range.first,range.last)
        end
        tx:put("reading",codec.encode(data)); tx:put("reading_baseline:"..source,codec.encode({generation=generation,epoch=value.epoch}))
        return true
    end)
end
return M
