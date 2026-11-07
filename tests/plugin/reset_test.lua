package.path="plugin/?.lua;"..package.path
local reset=require("reset")
local profile=require("profile")
local codec=require("codec")
local envelope=require("envelope")
local json=require("wire_json")
local id="48bc0344-efad-4c68-adb6-dc0f0ba57276"
local device="a92e58b4-851b-467b-a5ad-1eaaccc84c61"
local config={schema_version=1,instance_id=id,reporting_timezone="UTC",characters_per_page=2000,reset_generation=0,unicode_version=require("unicode_lower").version}
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
local function vocab_baseline(gen,items) return reset.vocabulary_baseline(store,codec,gen,items,build,reset.vocabulary_begin_baseline(store,codec,gen)) end
assert(reset.vocabulary_saved(store,codec,1,records[1],"save-before-ticket"))
local vocab_ticket=reset.vocabulary_begin_baseline(store,codec,1)
assert(reset.vocabulary_saved(store,codec,1,records[1],"save-during-baseline"))
assert(reset.vocabulary_baseline(store,codec,1,nil,build,vocab_ticket)==nil)
assert(not pcall(function() reset.vocabulary_baseline(store,codec,1,{[2]=records[1]},build,vocab_ticket) end))
assert(not pcall(function() reset.vocabulary_baseline(store,codec,1,{records[1],unexpected=records[1]},build,vocab_ticket) end))
local baseline=reset.vocabulary_baseline(store,codec,1,records,build,vocab_ticket)
local seq,bytes=baseline.seq,baseline.packet
assert(seq==2 and packets[1]=="old-generation-bytes" and packets[2]==bytes)
local retry=reset.vocabulary_baseline(store,codec,1,records,build,vocab_ticket)
assert(retry.seq==seq and retry.packet==bytes and state.seq=="2")
assert(not pcall(function() snapshot(1,records,build) end))
local ack={schema_version=1,instance_id=id,device_id=device,source_id=json.null,reset_generation=1,current_reset_generation=1,seq=2,kind="vocabulary_snapshot",status="applied",results={vocabulary_snapshot="applied"}}
local wrong=codec.decode(codec.encode(ack)); wrong.seq=1
assert(not reset.vocabulary_ack(store,codec,codec.encode(wrong)))
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)) and reset.vocabulary_ack(store,codec,codec.encode(ack)))
local out=snapshot(1,records,build)
assert(codec.decode(out).payload.words[1].word=="word")
local changed_case={{id="word",word="WORD",language=json.null,source="dictionary",fingerprint="changed"}}
out=snapshot(1,changed_case,build)
assert(codec.decode(out).payload.words[1].word=="WORD")
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
local newbaseline=vocab_baseline(2,records)
ack.reset_generation=2; ack.current_reset_generation=2; ack.seq=newbaseline.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)) and reset.vocabulary_ack(store,codec,codec.encode(ack)))
local before=state.seq
assert(reset.vocabulary_saved(store,codec,2,records[1],"save-2"))
local function mutate_word(seq,snapshot) snapshot.words[1].word="forged"; return build(seq,snapshot) end
assert(not pcall(function() snapshot(2,records,mutate_word) end))
assert(not pcall(function() snapshot(2,records,malicious) end))
assert(state.seq==before)
local duplicate={records[1],records[1]}
local before_duplicate=state.seq
assert(not pcall(function() snapshot(2,duplicate,build) end))
assert(state.seq==before_duplicate)
assert(codec.decode(snapshot(2,records,build)).payload.words[1].word=="word")


assert(reset.vocabulary_identity({word="Word",language="EN"})==reset.vocabulary_identity({word="word",language="en"}))
assert(reset.vocabulary_identity({word="word",language=json.null})~=reset.vocabulary_identity({word="word",language=""}))
assert(reset.vocabulary_identity({word="É",language=json.null})==reset.vocabulary_identity({word="é",language=json.null}))
assert(reset.vocabulary_identity({word="ΟΣ",language=json.null})==reset.vocabulary_identity({word="ος",language=json.null}))
assert(reset.vocabulary_identity({word="İ",language=json.null})==reset.vocabulary_identity({word="i̇",language=json.null}))
assert(snapshot(2,{{word="é",language=json.null,source=json.null}},build))
assert(reset.vocabulary_identity({word="ПРИВЕТ",language="RU"})==reset.vocabulary_identity({word="привет",language="ru"}))
assert(reset.vocabulary_identity({word="ЁЖ",language="ru"})==reset.vocabulary_identity({word="ёж",language="ru"}))
-- A post-baseline save arriving before the empty packet ack survives restart.
config.reset_generation=3; wire.reset_generation=3; profile.accept(store,codec,config,device)
local third=vocab_baseline(3,records)
assert(reset.vocabulary_saved(store,codec,3,records[1],"native-save-1"))
assert(not reset.vocabulary_saved(store,codec,3,records[1],"native-save-1"))
assert(not pcall(function() snapshot(3,records,build) end))
ack.reset_generation=3; ack.current_reset_generation=3; ack.seq=third.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)) and reset.vocabulary_ack(store,codec,codec.encode(ack)))
local after_restart=snapshot(3,records,build)
assert(codec.decode(after_restart).payload.words[1].word=="word")


config.reset_generation=4; wire.reset_generation=4; profile.accept(store,codec,config,device)
local fourth=vocab_baseline(4,records)
ack.reset_generation=4; ack.current_reset_generation=4; ack.seq=fourth.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)) and reset.vocabulary_ack(store,codec,codec.encode(ack)))
local before_read=reset.vocabulary_watermark(store,codec,4)
assert(reset.vocabulary_saved(store,codec,4,records[1],"native-save-after-read"))
assert(reset.vocabulary_snapshot(store,codec,4,{},before_read,build))
local after_read=reset.vocabulary_watermark(store,codec,4)
local again=reset.vocabulary_snapshot(store,codec,4,records,after_read,build)
assert(codec.decode(again).payload.words[1].word=="word")

config.reset_generation=5; wire.reset_generation=5; profile.accept(store,codec,config,device)
local fifth=vocab_baseline(5,records)
ack.reset_generation=5; ack.current_reset_generation=5; ack.seq=fifth.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)) and reset.vocabulary_ack(store,codec,codec.encode(ack)))
assert(reset.vocabulary_saved(store,codec,5,records[1],"native-save-absent"))
local mark=reset.vocabulary_watermark(store,codec,5)
assert(not pcall(function() reset.vocabulary_snapshot(store,codec,5,{},mark,malicious) end))
assert(reset.vocabulary_snapshot(store,codec,5,{},mark,build))
-- A later complete read, including after restart, must still see the save.
assert(codec.decode(snapshot(5,records,build)).payload.words[1].word=="word")
local old_read=reset.vocabulary_watermark(store,codec,5)
local new_read=reset.vocabulary_watermark(store,codec,5)
local deduped_seq=state.seq
-- The same filtered set as the previous packet is not queued again.
assert(reset.vocabulary_snapshot(store,codec,5,records,new_read,build)==true and state.seq==deduped_seq)
local committed_seq=state.seq
assert(not pcall(function() reset.vocabulary_snapshot(store,codec,5,{},old_read,build) end))
assert(state.seq==committed_seq)
config.reset_generation=6; wire.reset_generation=6; profile.accept(store,codec,config,device)
local sixth=vocab_baseline(6,records)
ack.reset_generation=6; ack.current_reset_generation=6; ack.seq=sixth.seq
assert(reset.vocabulary_ack(store,codec,codec.encode(ack)) and reset.vocabulary_ack(store,codec,codec.encode(ack)))
local read_a=reset.vocabulary_watermark(store,codec,6)
assert(reset.vocabulary_saved(store,codec,6,records[1],"save-between-reads"))
local read_b=reset.vocabulary_watermark(store,codec,6)
assert(codec.decode(reset.vocabulary_snapshot(store,codec,6,records,read_b,build)).payload.words[1].word=="word")
local seq_b=state.seq
assert(not pcall(function() reset.vocabulary_snapshot(store,codec,6,{},read_a,build) end))
assert(state.seq==seq_b)

local legacy=require("legacy")
local source=("a"):rep(64)
local source_module=require("source")
local meta={format="epub",title="Synthetic",authors={},language=json.null,identifiers={}}
local function source_build(seq,sections) return envelope.source(wire,seq,"2026-01-01T00:00:00Z",source,sections) end
local meta_packet=source_module.reset_metadata(store,codec,6,source,meta,source_build)
assert(meta_packet and codec.decode(meta_packet.packet).payload.metadata.value.format=="epub")
local meta_ack={schema_version=1,instance_id=id,device_id=device,source_id=source,reset_generation=6,current_reset_generation=6,seq=meta_packet.seq,kind="source_snapshot",status="applied",results={metadata="applied"}}
local stale=codec.decode(codec.encode(meta_ack)); stale.reset_generation=5
assert(not source_module.reset_metadata_ack(store,codec,codec.encode(stale)))
local function legacy_build(seq,payload) return envelope.legacy(wire,seq,"2026-01-01T00:00:00Z",source,payload) end
local native={{date="2026-01-01",native_pages=10,native_seconds=20}}
local ticket=legacy.begin_baseline(store,codec,6,source)
local function altered_legacy(seq,payload) payload.records[1].native_pages=999; return legacy_build(seq,payload) end
local initial_seq=state.seq
assert(not pcall(function() legacy.baseline(store,codec,6,source,{records={{date="2026-01-01",native_pages=10,native_seconds=20}},epoch=id,verified=true},id,device,ticket,altered_legacy) end))
assert(state.seq==initial_seq)
assert(legacy.baseline(store,codec,6,source,nil,id,device,ticket,legacy_build)==nil)
assert(not pcall(function() legacy.baseline(store,codec,6,source,{records={[2]=native[1]},epoch=id,verified=true},id,device,ticket,legacy_build) end))
assert(not pcall(function() legacy.baseline(store,codec,6,source,{records=native,epoch=id,verified=false},id,device,ticket,legacy_build) end))
local initial=legacy.baseline(store,codec,6,source,{records=native,epoch=id,verified=true},id,device,ticket,legacy_build)
assert(codec.decode(initial.packet).payload.mode=="baseline")
assert(initial.pending and packets[initial.seq]==nil)
assert(legacy.resume_baseline(store,codec,6,source).pending)
local early={schema_version=1,instance_id=id,device_id=device,source_id=source,reset_generation=6,current_reset_generation=6,seq=initial.seq,kind="legacy_statistics",status="applied",results={legacy_statistics="applied"}}
assert(not legacy.ack(store,codec,codec.encode(early)))
assert(source_module.reset_metadata_ack(store,codec,codec.encode(meta_ack)))
assert(legacy.resume_baseline(store,codec,6,source).seq==initial.seq)
assert(packets[initial.seq]==initial.packet)
assert(not pcall(function() legacy.after_baseline(store,codec,6,source,{records=native,epoch=id,verified=true},legacy_build) end))
local legacy_ack={schema_version=1,instance_id=id,device_id=device,source_id=source,reset_generation=6,current_reset_generation=6,seq=initial.seq,kind="legacy_statistics",status="applied",results={legacy_statistics="applied"}}
local malformed=codec.decode(codec.encode(legacy_ack)); malformed.extra=true
assert(not legacy.ack(store,codec,codec.encode(malformed)))
assert(legacy.ack(store,codec,codec.encode(legacy_ack)))
local next_packet=legacy.after_baseline(store,codec,6,source,{records={{date="2026-01-01",native_pages=11,native_seconds=22}},epoch=id,verified=true},legacy_build)
assert(codec.decode(next_packet).payload.mode=="snapshot")
assert(not pcall(function() legacy.after_baseline(store,codec,6,source,{records=native,epoch=device,verified=true},legacy_build) end))
assert(not pcall(function() legacy.after_baseline(store,codec,6,source,{records=native,epoch=id,verified=true},legacy_build) end))
config.reset_generation=7; wire.reset_generation=7; profile.accept(store,codec,config,device)
assert(not pcall(function() legacy.begin_baseline(store,codec,7,source) end))
local next_meta=source_module.reset_metadata(store,codec,7,source,meta,source_build)
meta_ack.seq=next_meta.seq; meta_ack.reset_generation=7; meta_ack.current_reset_generation=7
assert(source_module.reset_metadata_ack(store,codec,codec.encode(meta_ack)))
local newer_ticket=legacy.begin_baseline(store,codec,7,source)
assert(not pcall(function() legacy.baseline(store,codec,7,source,{records=native,epoch=id,verified=true},id,device,ticket,legacy_build) end))
assert(not pcall(function() legacy.baseline(store,codec,7,source,{records=native,epoch=id,verified=true},id,device,newer_ticket,legacy_build) end))

local annotations=require("annotations")
local note={key="native-note",selection="selection",kind="highlight",start={type="xpointer",value="a"},["end"]={type="xpointer",value="b"},quote="synthetic",note="",chapter=json.null,native_timestamp=json.null}
state.annotations=codec.encode({sources={[source]={[note.key]={annotation_id=device,selection=note.selection,kind=note.kind,context={status="pending",reason="unavailable"}}}},owners={[device]={source=source,key=note.key}},versions={}})
local function annotation_build(seq,version,rows) return envelope.annotations(wire,seq,"2026-01-01T00:00:00Z",source,version,rows) end
local function allocate() return id end
local function extract() return {status="pending",reason="unavailable"} end
local annotation_ticket=annotations.begin_reset(store,codec,7,source)
assert(not pcall(function() annotations.reset_baseline(store,codec,7,source,annotation_ticket,{[2]=note}) end))
assert(annotations.reset_baseline(store,codec,7,source,annotation_ticket,{note}))
local empty_packet=annotations.reset_snapshot(store,codec,7,source,annotations.begin_read(store,codec,7,source),{note},allocate,extract,annotation_build)
assert(#codec.decode(empty_packet).payload.annotations.value==0)
assert(annotations.reset_saved(store,codec,7,source,note.key,"native-save-1"))
local function altered_annotation(seq,version,rows) rows[1].note="forged"; return annotation_build(seq,version,rows) end
local invalid_read=annotations.begin_read(store,codec,7,source)
assert(not pcall(function() annotations.reset_snapshot(store,codec,7,source,invalid_read,{note},allocate,extract,altered_annotation) end))
local saved_packet=annotations.reset_snapshot(store,codec,7,source,annotations.begin_read(store,codec,7,source),{note},allocate,extract,annotation_build)
assert(codec.decode(saved_packet).payload.annotations.value[1].annotation_id==id)
assert(not annotations.reset_saved(store,codec,7,source,note.key,"native-save-1"))
local before_save=annotations.begin_read(store,codec,7,source)
assert(annotations.reset_saved(store,codec,7,source,note.key,"native-save-2"))
local older=annotations.reset_snapshot(store,codec,7,source,before_save,{note},allocate,extract,annotation_build)
assert(codec.decode(older).payload.annotations.value[1].annotation_id==id)
local next_id="11111111-1111-4111-8111-111111111111"
local later=annotations.reset_snapshot(store,codec,7,source,annotations.begin_read(store,codec,7,source),{note},function() return next_id end,extract,annotation_build)
assert(codec.decode(later).payload.annotations.value[1].annotation_id==next_id)
assert(not pcall(function() annotations.reset_snapshot(store,codec,7,source,before_save,{note},allocate,extract,annotation_build) end))
local race_source=("c"):rep(64)
state["source_ack_generation:"..race_source]="7"
assert(annotations.reset_saved(store,codec,7,race_source,note.key,"save-before-ticket"))
local race_ticket=annotations.begin_reset(store,codec,7,race_source)
assert(annotations.reset_saved(store,codec,7,race_source,note.key,"save-during-baseline"))
assert(annotations.reset_baseline(store,codec,7,race_source,race_ticket,{note}))
local function race_build(seq,version,rows) return envelope.annotations(wire,seq,"2026-01-01T00:00:00Z",race_source,version,rows) end
local race_packet=annotations.reset_snapshot(store,codec,7,race_source,annotations.begin_read(store,codec,7,race_source),{note},function() return "22222222-2222-4222-8222-222222222222" end,extract,race_build)
assert(#codec.decode(race_packet).payload.annotations.value==1)

local capture=require("capture")
local reading_source=("b"):rep(64)
state["source_ack_generation:"..reading_source]="7"
local compare=function(a,b) return a-b end
local measure=function(a,b) return b-a end
local sample={source=reading_source,day="2026-01-01",native_id="native",seconds=12,first=0,last=5,native_epoch=id,reset_verified=true,timing={from=10,to=12,quality="estimated_native_anchor",anchor="2026-01-01T00:00:00Z"}}
local function reading_build(seq,seconds,pieces) return seq..":"..seconds..":"..#pieces..":"..pieces[1].characters end
assert(not pcall(function() capture.record(store,codec,compare,measure,sample,reading_build) end))
local reading_ticket=capture.begin_reset(store,codec,7,reading_source)
assert(not pcall(function() capture.reset_baseline(store,codec,7,reading_source,reading_ticket,{verified=true,epoch=id,native={[2]={id="native",seconds=10}},ranges={}},compare) end))
assert(capture.reset_baseline(store,codec,7,reading_source,reading_ticket,{verified=true,epoch=id,native={{id="native",seconds=10}},ranges={{day="2026-01-01",first=0,last=3}}},compare))
local reading_packet=capture.record(store,codec,compare,measure,sample,reading_build)
assert(reading_packet:match(":2:1:2$"))
sample.native_epoch=device
assert(not pcall(function() capture.record(store,codec,compare,measure,sample,reading_build) end))
config.reset_generation=8; config.unicode_version="0.0"; profile.accept(store,codec,config,device)
assert(not pcall(function() reset.vocabulary_begin_baseline(store,codec,8) end))
