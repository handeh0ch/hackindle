package.path="plugin/?.lua;"..package.path
local reset=require("reset")
local profile=require("profile")
local codec=require("codec")
local envelope=require("envelope")
local json=require("wire_json")
local id="48bc0344-efad-4c68-adb6-dc0f0ba57276"
local device="a92e58b4-851b-467b-a5ad-1eaaccc84c61"
local config={schema_version=1,instance_id=id,reporting_timezone="UTC",characters_per_page=2000,reset_generation=0}
local wire={instance_id=id,device_id=device,reset_generation=1}
local state,packets={},{[1]="old-generation-bytes"}
local function clone(v) if type(v)~="table" then return v end; local o={}; for k,x in pairs(v) do o[k]=clone(x) end; return o end
local store={}
function store:transaction(work)
 local pending,queued=clone(state),clone(packets)
 local tx={}; function tx:get(k) return pending[k] end; function tx:put(k,v) pending[k]=v end
 function tx:enqueue(k,v) assert(not queued[k]); queued[k]=v end
 local result=work(tx); state,packets=pending,queued; return result
end
profile.accept(store,codec,config,device)
state.seq="1"; config.reset_generation=1
profile.accept(store,codec,config,device)
local records={{id="word",word="word",language=json.null,source=json.null,fingerprint="same"}}
local function build(seq, snapshot) return envelope.vocabulary(wire,seq,"2026-01-01T00:00:00Z",snapshot) end
local function snapshot(gen,items,builder) return reset.vocabulary_snapshot(store,codec,gen,items,reset.vocabulary_watermark(store,codec,gen),builder) end
assert(reset.vocabulary_baseline(store,codec,1,nil,build)==nil)
local baseline=reset.vocabulary_baseline(store,codec,1,records,build)
local seq,bytes=baseline.seq,baseline.packet
assert(seq==2 and packets[1]=="old-generation-bytes" and packets[2]==bytes)
local retry=reset.vocabulary_baseline(store,codec,1,records,build)
assert(retry.seq==seq and retry.packet==bytes and state.seq=="2")
assert(not pcall(function() snapshot(1,records,build) end))
local ack={schema_version=1,instance_id=id,device_id=device,source_id=json.null,reset_generation=1,current_reset_generation=1,seq=2,kind="vocabulary_snapshot",status="applied",results={vocabulary_snapshot="applied"}}
local wrong=codec.decode(codec.encode(ack)); wrong.seq=1
assert(not reset.vocabulary_ack(store,codec,codec.encode(wrong)))
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)))
local out=snapshot(1,records,build)
assert(codec.decode(out).payload.words[1]==nil)
local changed_case={{id="word",word="WORD",language=json.null,source="dictionary",fingerprint="changed"}}
out=snapshot(1,changed_case,build)
assert(#codec.decode(out).payload.words==0)
assert(reset.vocabulary_saved(store,codec,1,records[1],"save-1"))
out=snapshot(1,records,build)
assert(codec.decode(out).payload.words[1].word=="word")
assert(packets[1]=="old-generation-bytes" and packets[2]==bytes)
config.reset_generation=2; profile.accept(store,codec,config,device)
assert(not pcall(function() snapshot(1,records,build) end))
print("reset vocabulary assertions passed")

local previous_seq=state.seq
local function malicious(seq,snapshot)
    snapshot.words={{word="wrong",language=json.null,source=json.null}}
    return build(seq,snapshot)
end
-- Reinitialize a separate acknowledged barrier for a new generation.
wire.reset_generation=2
local newbaseline=reset.vocabulary_baseline(store,codec,2,records,build)
ack.reset_generation=2; ack.current_reset_generation=2; ack.seq=newbaseline.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)))
local before=state.seq
assert(reset.vocabulary_saved(store,codec,2,records[1],"save-2"))
assert(not pcall(function() snapshot(2,records,malicious) end))
assert(state.seq==before)
local duplicate={records[1],records[1]}
local before_duplicate=state.seq
assert(not pcall(function() snapshot(2,duplicate,build) end))
assert(state.seq==before_duplicate)
assert(codec.decode(snapshot(2,records,build)).payload.words[1].word=="word")


assert(reset.vocabulary_identity({word="Word",language="EN"})==reset.vocabulary_identity({word="word",language="en"}))
assert(reset.vocabulary_identity({word="word",language=json.null})~=reset.vocabulary_identity({word="word",language=""}))
assert(not pcall(function() reset.vocabulary_identity({word="é",language=json.null}) end))
assert(not pcall(function() snapshot(2,{{word="é",language=json.null,source=json.null}},build) end))
assert(reset.vocabulary_identity({word="ПРИВЕТ",language="RU"})==reset.vocabulary_identity({word="привет",language="ru"}))
assert(reset.vocabulary_identity({word="ЁЖ",language="ru"})==reset.vocabulary_identity({word="ёж",language="ru"}))
-- A post-baseline save arriving before the empty packet ack survives restart.
config.reset_generation=3; wire.reset_generation=3; profile.accept(store,codec,config,device)
local third=reset.vocabulary_baseline(store,codec,3,records,build)
assert(reset.vocabulary_saved(store,codec,3,records[1],"native-save-1"))
assert(not reset.vocabulary_saved(store,codec,3,records[1],"native-save-1"))
assert(not pcall(function() snapshot(3,records,build) end))
ack.reset_generation=3; ack.current_reset_generation=3; ack.seq=third.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)))
local after_restart=snapshot(3,records,build)
assert(codec.decode(after_restart).payload.words[1].word=="word")


config.reset_generation=4; wire.reset_generation=4; profile.accept(store,codec,config,device)
local fourth=reset.vocabulary_baseline(store,codec,4,records,build)
ack.reset_generation=4; ack.current_reset_generation=4; ack.seq=fourth.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)))
local before_read=reset.vocabulary_watermark(store,codec,4)
assert(reset.vocabulary_saved(store,codec,4,records[1],"native-save-after-read"))
assert(reset.vocabulary_snapshot(store,codec,4,{},before_read,build))
local after_read=reset.vocabulary_watermark(store,codec,4)
local again=reset.vocabulary_snapshot(store,codec,4,records,after_read,build)
assert(codec.decode(again).payload.words[1].word=="word")

config.reset_generation=5; wire.reset_generation=5; profile.accept(store,codec,config,device)
local fifth=reset.vocabulary_baseline(store,codec,5,records,build)
ack.reset_generation=5; ack.current_reset_generation=5; ack.seq=fifth.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)))
assert(reset.vocabulary_saved(store,codec,5,records[1],"native-save-absent"))
local mark=reset.vocabulary_watermark(store,codec,5)
assert(not pcall(function() reset.vocabulary_snapshot(store,codec,5,{},mark,malicious) end))
assert(reset.vocabulary_snapshot(store,codec,5,{},mark,build))
-- A later complete read, including after restart, must still see the save.
assert(codec.decode(snapshot(5,records,build)).payload.words[1].word=="word")
local old_read=reset.vocabulary_watermark(store,codec,5)
local new_read=reset.vocabulary_watermark(store,codec,5)
assert(reset.vocabulary_snapshot(store,codec,5,records,new_read,build))
local committed_seq=state.seq
assert(not pcall(function() reset.vocabulary_snapshot(store,codec,5,{},old_read,build) end))
assert(state.seq==committed_seq)
config.reset_generation=6; wire.reset_generation=6; profile.accept(store,codec,config,device)
local sixth=reset.vocabulary_baseline(store,codec,6,records,build)
ack.reset_generation=6; ack.current_reset_generation=6; ack.seq=sixth.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)))
local read_a=reset.vocabulary_watermark(store,codec,6)
assert(reset.vocabulary_saved(store,codec,6,records[1],"save-between-reads"))
local read_b=reset.vocabulary_watermark(store,codec,6)
assert(codec.decode(reset.vocabulary_snapshot(store,codec,6,records,read_b,build)).payload.words[1].word=="word")
local seq_b=state.seq
assert(not pcall(function() reset.vocabulary_snapshot(store,codec,6,{},read_a,build) end))
assert(state.seq==seq_b)
