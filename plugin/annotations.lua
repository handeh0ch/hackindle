local state_store = require("state")
local M = {}
-- Native keys and selection fingerprints are provisional adapter inputs.
function M.update(state, source, record, allocate, extract)
    state.sources = state.sources or {}
    state.owners = state.owners or {}
    state.sources[source] = state.sources[source] or {}
    local prior = state.sources[source][record.key]
    local id = prior and prior.annotation_id or allocate()
    assert(type(id) == "string" and id ~= "", "annotation ID unavailable")
    local owner = state.owners[id]
    assert(not owner or (owner.source == source and owner.key == record.key), "annotation ID collision")
    local changed = not prior or prior.selection ~= record.selection or prior.kind ~= record.kind
    local value = prior and prior.context
    if record.kind == "bookmark" then
        assert(record.null ~= nil, "JSON null sentinel required")
        value = record.null
    elseif changed or (value and value.status == "pending") then
        local origin = changed and not record.backfill and "creation" or "backfill"
        local ok, result = pcall(extract, record, origin)
        value = ok and result or nil
        if type(value) ~= "table" then value = {status = "pending", reason = "context extraction unavailable"} end
    end
    local saved = {annotation_id = id, selection = record.selection, kind = record.kind, context = value}
    state.sources[source][record.key] = saved
    state.owners[id] = {source = source, key = record.key}
    return {annotation_id = id, kind = record.kind, start = record.start, ["end"] = record["end"],
        quote = record.quote, note = record.note, chapter = record.chapter,
        native_timestamp = record.native_timestamp, context = value}
end
-- records must be a successfully read complete set, not an unavailable source.
function M.snapshot(store, codec, source, records, allocate, extract, build_packet, guard_packet)
    if records == nil then return nil end
    return store:transaction(function(tx)
        state_store.assert_capture_enabled(tx)
        local encoded = tx:get("annotations")
        local data = encoded and codec.decode(encoded) or {}
        data.versions = data.versions or {}
        local rows, seen = {}, {}
        for _, record in ipairs(records) do
            assert(type(record.key) == "string" and record.key ~= "" and not seen[record.key], "invalid native annotation identity")
            seen[record.key] = true
            rows[#rows + 1] = M.update(data, source, record, allocate, extract)
        end
        local version = (data.versions[source] or 0) + 1
        assert(version <= 9007199254740991, "annotation version exhausted")
        local seq = state_store.next_sequence(tx)
        local packet = build_packet(seq, version, rows)
        assert(type(packet) == "string", "packet encoding failed")
        if guard_packet then guard_packet(tx,packet) end
        data.versions[source] = version
        tx:put("annotations", codec.encode(data))
        tx:enqueue(seq, packet)
        return packet
    end)
end
local function reset_policy(tx,codec,generation)
    local p=require("profile").policy_tx(tx,codec)
    assert(p.baseline_required and p.generation==generation, "annotation reset generation changed")
    return p
end
local function mapped(records)
    assert(type(records)=="table", "annotation read unavailable")
    local count=0
    for key in pairs(records) do assert(type(key)=="number" and key>=1 and key==math.floor(key), "incomplete annotation read"); count=count+1 end
    for i=1,count do assert(records[i]~=nil, "incomplete annotation read") end
    local out={}; for _,r in ipairs(records) do out[#out+1]={id=r.key,record=r} end
    return out
end
local function fingerprint(item) return require("codec").encode(item.record) end
function M.begin_reset(store,codec,generation,source)
    return store:transaction(function(tx)
        reset_policy(tx,codec,generation)
        local ticket=state_store.next_counter(tx,"annotation_ticket")
        tx:put("annotation_baseline_ticket:"..source,codec.encode({generation=generation,ticket=ticket}))
        return ticket
    end)
end
function M.reset_baseline(store,codec,generation,source,ticket,records)
    if records==nil then return nil end
    return store:transaction(function(tx)
        reset_policy(tx,codec,generation)
        local encoded=tx:get("annotation_baseline_ticket:"..source); local issued=encoded and codec.decode(encoded)
        assert(issued and issued.generation==generation and issued.ticket==ticket,"annotation baseline ticket invalid")
        require("profile").baseline_tx(tx,codec,"annotations",source,generation,mapped(records),fingerprint)
        return true
    end)
end
-- event_id must come from a native save observed after the baseline. This
-- adapter signal is provisional and is not established by this module.
function M.reset_saved(store,codec,generation,source,key,event_id)
    assert(type(key)=="string" and key~="" and type(event_id)=="string" and event_id~="", "native save identity unavailable")
    return store:transaction(function(tx)
        reset_policy(tx,codec,generation)
        local event_key="annotation_save_event:"..event_id; local prior=tx:get(event_key)
        if prior then local old=codec.decode(prior); assert(old.generation==generation and old.source==source and old.key==key, "native save identity conflict"); return false end
        local saved=tx:get("annotation_saves:"..source); local saves=saved and codec.decode(saved) or {generation=generation,ids={}}
        if saves.generation~=generation then saves={generation=generation,ids={}} end
        local order=state_store.next_counter(tx,"annotation_save_order")
        saves.ids[key]=order
        tx:put(event_key,codec.encode({generation=generation,source=source,key=key}))
        tx:put("annotation_saves:"..source,codec.encode(saves)); return true
    end)
end
function M.begin_read(store,codec,generation,source)
    return store:transaction(function(tx)
        reset_policy(tx,codec,generation)
        assert(require("profile").ready_tx(tx,codec,"annotations",source), "annotation baseline pending")
        local order=tonumber(tx:get("annotation_save_order") or "0")
        local ticket=state_store.next_counter(tx,"annotation_ticket")
        tx:put("annotation_read:"..source,codec.encode({generation=generation,ticket=ticket,order=order}))
        return ticket
    end)
end
function M.reset_snapshot(store,codec,generation,source,ticket,records,allocate,extract,build)
    if records==nil then return nil end
    return store:transaction(function(tx)
        local p=reset_policy(tx,codec,generation)
        assert(tx:get("source_ack_generation:"..source)==string.format("%.0f",generation), "source metadata acknowledgement pending")
        local read=tx:get("annotation_read:"..source); local issued=read and codec.decode(read)
        local committed=tonumber(tx:get("annotation_committed:"..source) or "0")
        assert(issued and issued.generation==generation and issued.ticket==ticket and ticket>committed, "annotation read ticket invalid")
        local encoded=tx:get("annotation_saves:"..source); local saves=encoded and codec.decode(encoded) or {generation=generation,ids={}}
        if saves.generation~=generation then saves={generation=generation,ids={}} end
        local new={}; for key,order in pairs(saves.ids) do if order<=issued.order then new[key]=true end end
        local entries=mapped(records); local filtered=require("profile").filter_tx(tx,codec,"annotations",source,entries,fingerprint,new)
        local serialized=tx:get("annotations"); local data=serialized and codec.decode(serialized) or {}
        data.versions=data.versions or {}; local rows={}
        for _,item in ipairs(filtered) do
            if new[item.id] and data.sources and data.sources[source] then data.sources[source][item.id]=nil end
            rows[#rows+1]=M.update(data,source,item.record,allocate,extract)
            if new[item.id] then saves.ids[item.id]=nil end
        end
        local version=(data.versions[source] or 0)+1; assert(version<=9007199254740991,"annotation version exhausted")
        local seq=state_store.next_sequence(tx)
        local wire=require("codec")
        local copy=wire.decode(wire.encode(require("wire_json").array(rows)))
        local expected_packet=require("envelope").annotations({instance_id=p.instance_id,device_id=p.device_id,reset_generation=generation},seq,"2024-01-01T00:00:00Z",source,version,copy)
        local expected=wire.encode(wire.decode(expected_packet).payload)
        local bytes=build(seq,version,rows)
        assert(require("validator").validate(bytes), "invalid annotations packet")
        local packet=require("codec").decode(bytes)
        assert(packet.kind=="source_snapshot" and packet.instance_id==p.instance_id and packet.device_id==p.device_id
            and packet.source_id==source and packet.reset_generation==generation and packet.seq==seq
            and packet.payload.annotations and packet.payload.annotations.version==version, "annotation packet identity mismatch")
        assert(wire.encode(packet.payload)==expected, "annotation packet content mismatch")
        data.versions[source]=version; tx:put("annotations",codec.encode(data)); tx:put("annotation_saves:"..source,codec.encode(saves))
        tx:put("annotation_committed:"..source,string.format("%.0f",ticket)); tx:enqueue(seq,bytes)
        return bytes
    end)
end
return M
