import copy
import json
import subprocess
from lupa.luajit21 import LuaRuntime

ID = "48bc0344-efad-4c68-adb6-dc0f0ba57276"
SOURCE = "a" * 64
instant = "2026-01-01T00:00:00Z"
base = {"schema_version":1,"instance_id":ID,"device_id":ID,"reset_generation":0,"seq":1,
        "captured_at":instant,"kind":"source_snapshot","source_id":SOURCE,
        "payload":{"metadata":{"version":1,"value":{"format":"epub","title":"Synthetic","authors":[],"language":None,"identifiers":[]}}}}
cases = []
def case(change):
    item = copy.deepcopy(base); change(item); cases.append(item)
case(lambda p: None)
case(lambda p: p.update(seq=0))
case(lambda p: p.update(device_id="bad"))
case(lambda p: p.update(captured_at="2025-02-29T00:00:00Z"))
case(lambda p: p["payload"]["metadata"]["value"].update(extra=True))
case(lambda p: p["payload"]["metadata"]["value"].update(format="azw3"))
case(lambda p: p["payload"]["metadata"]["value"].update(language="en",identifiers=[{"scheme":"x","value":"y","provenance":"z"}]))
case(lambda p: p["payload"].update(progress={"version":1,"value":{"fraction":0.5,"position":{"type":"xpointer","value":"p"},"observed_at":instant,"session_id":ID}}))
case(lambda p: p["payload"].update(progress={"version":1,"value":{"fraction":1.1,"position":{"type":"xpointer","value":"p"},"observed_at":instant,"session_id":ID}}))
case(lambda p: p["payload"].update(progress={"version":1,"value":{"fraction":0.5,"position":{"type":"pdf","page":1,"boxes":[],"geometry_version":None},"observed_at":instant,"session_id":ID}}))
case(lambda p: p["payload"].update(progress={"version":1,"value":{"fraction":0.5,"position":{"type":"pdf","page":1,"boxes":[],"geometry_version":"wrong"},"observed_at":instant,"session_id":ID}}))
script='''import {validateEnvelope} from "./contracts/validate.js"; let s=""; for await (const c of process.stdin) s+=c; console.log(JSON.stringify(JSON.parse(s).map(validateEnvelope)));'''
expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(cases),text=True,capture_output=True,check=True).stdout)
lua=LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path="projects/plugin/?.lua;"..package.path')
validator=lua.eval('require("protocol.validator")')
actual=[validator.validate(json.dumps(item,ensure_ascii=False)) for item in cases]
assert actual == expected, [(i, expected[i], actual[i]) for i in range(len(cases)) if expected[i] != actual[i]]
print(f'{len(cases)} source-envelope differential cases passed')
# Exercise all envelope kinds projected by the Lua capture components.
import runpy
projected = runpy.run_path('tests/plugin/validate_projection.py')['values']
cases.extend(copy.deepcopy(projected))
for sample in projected:
    bad=copy.deepcopy(sample); bad['unexpected']=True; cases.append(bad)
    bad=copy.deepcopy(sample); bad['captured_at']='2026-13-01T00:00:00Z'; cases.append(bad)
    bad=copy.deepcopy(sample); bad['seq']=0; cases.append(bad)
    if sample['kind'] == 'reading_events':
        bad=copy.deepcopy(sample); bad['payload']['events'][0]['source_id']='b'*64; cases.append(bad)
        bad=copy.deepcopy(sample); bad['payload']['events'].append(copy.deepcopy(bad['payload']['events'][0])); cases.append(bad)
        event=sample['payload']['events'][0]
        if event['type'] == 'reading_segment':
            bad=copy.deepcopy(sample); bad['payload']['events'][0]['credited_characters']=999; cases.append(bad)
            bad=copy.deepcopy(sample); bad['payload']['events'][0]['timing_quality']='bogus'; cases.append(bad)
    if sample['kind'] == 'source_snapshot' and 'annotations' in sample['payload'] and sample['payload']['annotations']['value']:
        bad=copy.deepcopy(sample); bad['payload']['annotations']['value'].append(copy.deepcopy(bad['payload']['annotations']['value'][0])); cases.append(bad)
        bad=copy.deepcopy(sample); bad['payload']['annotations']['value'][0]['context']={'status':'pending','reason':''}; cases.append(bad)
expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(cases),text=True,capture_output=True,check=True).stdout)
actual=[validator.validate(json.dumps(item,ensure_ascii=False)) for item in cases]
assert actual == expected, [(i, expected[i], actual[i]) for i in range(len(cases)) if expected[i] != actual[i]]
print(f'{len(cases)} complete-envelope differential cases passed')
with open('contracts/examples/synthetic.json',encoding='utf-8') as stream:
    fixtures=json.load(stream)['envelopes']
for sample in fixtures:
    cases.append(sample)
    for field, value in [('seq', 0), ('schema_version', 2), ('captured_at','2024-02-30T00:00:00Z'), ('reset_generation',-1)]:
        bad=copy.deepcopy(sample); bad[field]=value; cases.append(bad)
    bad=copy.deepcopy(sample); bad['payload']['extra']='unexpected'; cases.append(bad)
expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(cases),text=True,capture_output=True,check=True).stdout)
actual=[validator.validate(json.dumps(item,ensure_ascii=False)) for item in cases]
assert actual == expected, [(i, expected[i], actual[i], cases[i]['kind']) for i in range(len(cases)) if expected[i] != actual[i]]
print(f'{len(cases)} fixture-envelope differential cases passed')
def visit(value, path=()):
    if isinstance(value, dict):
        yield path, value
        for key, child in value.items(): yield from visit(child, path+(key,))
    elif isinstance(value, list):
        yield path, value
        for index, child in enumerate(value): yield from visit(child, path+(index,))
    else:
        yield path, value

def set_path(root, path, value):
    parent=root
    for key in path[:-1]: parent=parent[key]
    parent[path[-1]]=value

mutations=[]
for sample in fixtures:
    for path, value in visit(sample):
        if not path: continue
        if isinstance(value,dict):
            bad=copy.deepcopy(sample); target=bad
            for key in path: target=target[key]
            target['unexpected']=True; mutations.append(bad)
        elif not isinstance(value,list):
            for replacement in (None, False, -1, 'bad'):
                if replacement == value and type(replacement) == type(value): continue
                bad=copy.deepcopy(sample); set_path(bad,path,replacement); mutations.append(bad)
        if isinstance(path[-1],str):
            bad=copy.deepcopy(sample); parent=bad
            for key in path[:-1]: parent=parent[key]
            del parent[path[-1]]; mutations.append(bad)
expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(mutations),text=True,capture_output=True,check=True).stdout)
actual=[validator.validate(json.dumps(item,ensure_ascii=False)) for item in mutations]
false_accepts=[i for i,(want,got) in enumerate(zip(expected,actual)) if got and not want]
assert not false_accepts, [(i,mutations[i]) for i in false_accepts[:3]]
print(f'{len(mutations)} field-mutation comparisons: no false accepts; {sum(w and not a for w,a in zip(expected,actual))} conservative rejects')
segment_packet=next(x for x in fixtures if x['kind']=='reading_events')
segment_mutations=[]
def mutate_segment(fn):
    item=copy.deepcopy(segment_packet); fn(item['payload']['events'][0]); segment_mutations.append(item)
mutate_segment(lambda e: e.update(allocation=[{'date':'2024-02-29','seconds':10},{'date':'2024-02-28','seconds':0}]))
mutate_segment(lambda e: e.update(allocation=[{'date':'2024-02-29','seconds':10},{'date':'2024-02-29','seconds':0}]))
mutate_segment(lambda e: e.update(allocation=[{'date':'2024-02-29','seconds':9}]))
mutate_segment(lambda e: e.update(awake_windows=[{'start':'2024-02-29T00:00:00.000000002Z','end':'2024-02-29T00:00:00.000000001Z'}]))
mutate_segment(lambda e: e.update(awake_windows=[{'start':'2024-02-29T00:00:00.000000001Z','end':'2024-02-29T00:00:00.000000002Z'}]))
mutate_segment(lambda e: e.update(awake_windows=[{'start':'2024-02-29T00:00:00Z','end':'2024-02-29T00:00:02Z'},{'start':'2024-02-29T00:00:01Z','end':'2024-02-29T00:00:03Z'}]))
mutate_segment(lambda e: e.update(native_seconds=None,timing_quality='unavailable',allocation=[],awake_windows=[],native_anchor=None))
mutate_segment(lambda e: e.update(native_seconds=None,timing_quality='unavailable',allocation=[],awake_windows=[],native_anchor=None,volume_quality='unavailable',credited_characters=None,volume_date=None))
mutate_segment(lambda e: e.update(credited_characters=3,ranges=[{'start':{'type':'xpointer','value':'a'},'end':{'type':'xpointer','value':'b'},'characters':3}]))
mutate_segment(lambda e: e.update(credited_characters=3,ranges=[{'start':{'type':'xpointer','value':'a'},'end':{'type':'pdf','page':1,'boxes':[],'geometry_version':None},'characters':3}]))
expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(segment_mutations),text=True,capture_output=True,check=True).stdout)
actual=[validator.validate(json.dumps(item,ensure_ascii=False)) for item in segment_mutations]
assert actual == expected, [(i,w,a) for i,(w,a) in enumerate(zip(expected,actual)) if w!=a]
print(f'{len(segment_mutations)} timing and range differential cases passed')
# Deterministic byte-level mutations include truncation, invalid escapes and UTF-8.
from random import Random
rng=Random(417)
raw_seeds=[json.dumps(value,ensure_ascii=False,separators=(',',':')) for value in fixtures]
raw_cases=[]
for seed in raw_seeds:
    raw_cases.extend([seed[:0],seed[:-1],seed+'x',' '+seed+' ',seed.replace('"seq":', '"seq":0,"seq":',1)])
    for _ in range(100):
        offset=rng.randrange(len(seed)); char=rng.choice('{}[],:"\\-+eE0123456789abcdefxyz ')
        raw_cases.append(seed[:offset]+char+seed[offset+1:])
raw_script='''import {validateEnvelope} from "./contracts/validate.js"; let s=""; for await (const c of process.stdin) s+=c; console.log(JSON.stringify(JSON.parse(s).map(x=>{try{return validateEnvelope(JSON.parse(x))}catch{return false}})));'''
expected=json.loads(subprocess.run(['node','--input-type=module','-e',raw_script],input=json.dumps(raw_cases),text=True,capture_output=True,check=True).stdout)
actual=[validator.validate(item) for item in raw_cases]
false_accepts=[i for i,(want,got) in enumerate(zip(expected,actual)) if got and not want]
assert not false_accepts, [(i,raw_cases[i]) for i in false_accepts[:3]]
print(f'{len(raw_cases)} deterministic byte-mutation comparisons: no false accepts; {sum(w and not a for w,a in zip(expected,actual))} conservative rejects')
false_sections=[]
for name in ('metadata','progress','annotations'):
    alone=copy.deepcopy(base); alone['payload']={name:False}; false_sections.append(alone)
    combined=copy.deepcopy(base); combined['payload'][name]=False; false_sections.append(combined)
expected=json.loads(subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(false_sections),text=True,capture_output=True,check=True).stdout)
actual=[validator.validate(json.dumps(item)) for item in false_sections]
assert actual == expected == [False]*len(false_sections)
print(f'{len(false_sections)} false-section differential cases passed')
