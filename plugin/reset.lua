local profile=require("profile")
local state=require("state")
local validator=require("validator")
local json=require("wire_json")
local M={}
-- JS lowercasing is supported for ASCII and Russian Cyrillic letters only.
-- All other non-ASCII characters fail closed until full Unicode casing exists.
local function safe_lower(value)
    assert(type(value)=="string", "vocabulary identity unavailable")
    local out,i={},1
    while i<=#value do
        local a,b=value:byte(i,i+1)
        if a<128 then
            out[#out+1]=string.char(a>=65 and a<=90 and a+32 or a); i=i+1
        elseif a==0xD0 and b then
            if b==0x81 then out[#out+1]=string.char(0xD1,0x91)
            elseif b>=0x90 and b<=0x9F then out[#out+1]=string.char(0xD0,b+0x20)
            elseif b>=0xA0 and b<=0xAF then out[#out+1]=string.char(0xD1,b-0x20)
            elseif b>=0xB0 and b<=0xBF then out[#out+1]=string.char(a,b)
            else error("Unicode vocabulary identity unsupported") end
            i=i+2
        elseif a==0xD1 and b and ((b>=0x80 and b<=0x8F) or b==0x91) then
            out[#out+1]=string.char(a,b); i=i+2
        else error("Unicode vocabulary identity unsupported") end
    end
    return table.concat(out)
end
function M.vocabulary_identity(item)
    local word=safe_lower(item.word)
    local language=item.language==json.null and json.null or safe_lower(item.language)
    return require("codec").encode(json.array({word,language}))
end
local function vocabulary_records(records)
    local result={}
    for _,item in ipairs(records) do
        result[#result+1]={id=M.vocabulary_identity(item),word=item.word,language=item.language,source=item.source}
    end
    return result
end
local function identity_marker() return "baseline" end
local function policy(tx,codec,generation)
    local value=profile.policy_tx(tx,codec)
    assert(value.baseline_required and value.generation==generation and value.device_id, "reset generation changed")
    return value
end
local function packet_ok(bytes,p,generation,seq,version,words)
    assert(validator.validate(bytes), "invalid baseline packet")
    local packet=require("codec").decode(bytes)
    assert(packet.kind=="vocabulary_snapshot" and packet.instance_id==p.instance_id and packet.device_id==p.device_id
        and packet.reset_generation==generation and packet.seq==seq and packet.payload.version==version
        and require("codec").encode(packet.payload.words)==require("codec").encode(json.array(words)), "baseline packet identity mismatch")
    return packet
end
function M.vocabulary_baseline(store,codec,generation,records,build_packet)
    if records==nil then return nil end
    return store:transaction(function(tx)
        local p=policy(tx,codec,generation)
        local encoded=tx:get("reset_vocabulary")
        local previous=encoded and codec.decode(encoded)
        if previous and previous.generation==generation then
            assert(profile.ready_tx(tx,codec,"vocabulary","global"), "baseline state missing")
            return {seq=previous.seq,packet=previous.packet}
        end
        profile.baseline_tx(tx,codec,"vocabulary","global",generation,vocabulary_records(records),identity_marker)
        local version=state.next_counter(tx,"vocabulary_version")
        local seq=state.next_sequence(tx)
        local bytes=build_packet(seq,{version=version,words={}})
        packet_ok(bytes,p,generation,seq,version,{})
        tx:put("reset_vocabulary",codec.encode({generation=generation,seq=seq,packet=bytes,acknowledged=false}))
        tx:enqueue(seq,bytes)
        return {seq=seq,packet=bytes}
    end)
end
local function matches_ack(packet,ack)
    local fields={"schema_version","instance_id","device_id","source_id","reset_generation","seq","kind"}
    if type(ack)~="table" or ack==json.null or json.is_array(ack) then return false end
    local allowed={schema_version=true,instance_id=true,device_id=true,source_id=true,reset_generation=true,
        current_reset_generation=true,seq=true,kind=true,status=true,results=true}
    for key in pairs(ack) do if not allowed[key] then return false end end
    for _,key in ipairs(fields) do if ack[key]~=packet[key] then return false end end
    if ack.current_reset_generation~=packet.reset_generation or (ack.status~="applied" and ack.status~="duplicate") then return false end
    if type(ack.results)~="table" or ack.results==json.null or json.is_array(ack.results) then return false end
    for key in pairs(ack.results) do if key~="vocabulary_snapshot" then return false end end
    return ack.results.vocabulary_snapshot=="applied" or ack.results.vocabulary_snapshot=="duplicate"
end
function M.vocabulary_ack(store,codec,bytes)
    local ok,ack=pcall(require("codec").decode,bytes)
    if not ok then return false end
    return store:transaction(function(tx)
        local encoded=tx:get("reset_vocabulary")
        if not encoded then return false end
        local barrier=codec.decode(encoded)
        local p=profile.policy_tx(tx,codec)
        if p.generation~=barrier.generation or not p.baseline_required then return false end
        local valid,packet=pcall(require("codec").decode,barrier.packet)
        if not valid or not validator.validate(barrier.packet) then return false end
        local consistent=pcall(packet_ok,barrier.packet,p,barrier.generation,barrier.seq,packet.payload.version,{})
        if not consistent or not matches_ack(packet,ack) then return false end
        if not barrier.acknowledged then barrier.acknowledged=true; tx:put("reset_vocabulary",codec.encode(barrier)) end
        return true
    end)
end
-- The native adapter must identify a save observed after this generation's
-- baseline. Events are retained across restarts until a complete snapshot is
-- queued; reused event IDs cannot be relabelled for another generation.
function M.vocabulary_saved(store,codec,generation,item,event_id)
    assert(type(event_id)=="string" and event_id~="", "native save identity unavailable")
    local identity=M.vocabulary_identity(item)
    return store:transaction(function(tx)
        policy(tx,codec,generation)
        assert(profile.ready_tx(tx,codec,"vocabulary","global"), "vocabulary baseline pending")
        local key="vocabulary_save_event:"..event_id
        local prior=tx:get(key)
        if prior then
            local known=codec.decode(prior)
            assert(known.generation==generation and known.identity==identity, "native save identity conflict")
            return false
        end
        local encoded=tx:get("vocabulary_saves")
        local saves=encoded and codec.decode(encoded) or {}
        if saves.generation~=generation then saves={generation=generation,ids={}} end
        local order=state.next_counter(tx,"vocabulary_save_order")
        saves.ids[identity]=order
        tx:put(key,codec.encode({generation=generation,identity=identity}))
        tx:put("vocabulary_saves",codec.encode(saves))
        return true
    end)
end
-- Capture this watermark before reading the native set. Saves after it must
-- remain pending even if the read returns a stale snapshot.
function M.vocabulary_watermark(store,codec,generation)
    return store:transaction(function(tx)
        policy(tx,codec,generation)
        assert(profile.ready_tx(tx,codec,"vocabulary","global"), "vocabulary baseline pending")
        local value=tx:get("vocabulary_save_order")
        local number=value and tonumber(value) or 0
        assert((not value or (value:match("^%d+$") and number)) and number<=9007199254740991,"invalid save watermark")
        local ticket=state.next_counter(tx,"vocabulary_read_ticket")
        tx:put("vocabulary_pending_read",codec.encode({generation=generation,order=number,ticket=ticket}))
        return ticket
    end)
end
-- Queue delivery/ack authentication is the P2 transport's responsibility.
function M.vocabulary_snapshot(store,codec,generation,records,watermark,build_packet)
    if records==nil then return nil end
    return store:transaction(function(tx)
        local p=policy(tx,codec,generation)
        local encoded=tx:get("reset_vocabulary")
        local barrier=encoded and codec.decode(encoded)
        assert(barrier and barrier.generation==generation and barrier.acknowledged, "vocabulary baseline acknowledgement pending")
        assert(type(watermark)=="number" and watermark>0 and watermark==math.floor(watermark)
            and watermark<=9007199254740991, "invalid read ticket")
        local read=tx:get("vocabulary_pending_read")
        local issued=read and codec.decode(read)
        local last=tx:get("vocabulary_committed_read")
        local committed=last and tonumber(last) or 0
        assert((not last or (last:match("^%d+$") and committed)) and watermark>committed
            and issued and issued.generation==generation and issued.ticket==watermark, "stale or invalid read ticket")
        local order=tx:get("vocabulary_save_order")
        local latest=order and tonumber(order) or 0
        local save_order=issued.order
        assert(type(save_order)=="number" and save_order>=0 and save_order==math.floor(save_order)
            and save_order<=latest, "invalid save watermark")
        local pending=tx:get("vocabulary_saves")
        local saves=pending and codec.decode(pending) or {}
        if saves.generation~=generation then saves={generation=generation,ids={}} end
        local observed_new={}
        for identity, saved_order in pairs(saves.ids) do
            if saved_order<=save_order then observed_new[identity]=true end
        end
        local mapped=vocabulary_records(records)
        local present={}
        for _,item in ipairs(mapped) do present[item.id]=true end
        local filtered=profile.filter_tx(tx,codec,"vocabulary","global",mapped,identity_marker,observed_new)
        local words={}
        for _,item in ipairs(filtered) do words[#words+1]={word=item.word,language=item.language,source=item.source} end
        local version=state.next_counter(tx,"vocabulary_version")
        local seq=state.next_sequence(tx)
        local bytes=build_packet(seq,{version=version,words=words})
        packet_ok(bytes,p,generation,seq,version,words)
        for identity, saved_order in pairs(saves.ids) do
            if saved_order<=save_order and present[identity] then saves.ids[identity]=nil end
        end
        tx:put("vocabulary_saves",codec.encode(saves))
        tx:put("vocabulary_committed_read",string.format("%.0f",watermark))
        tx:enqueue(seq,bytes)
        return bytes
    end)
end
return M
