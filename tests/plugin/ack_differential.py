"""Compare the device's acknowledgement matching with the shared contract's matchesAck."""
import copy
import json
import runpy
import subprocess
from lupa.luajit21 import LuaRuntime

with open('contracts/examples/synthetic.json', encoding='utf-8') as stream:
    envelopes = json.load(stream)['envelopes']
envelopes += runpy.run_path('tests/plugin/validate_projection.py')['values']


def results_for(envelope):
    if envelope['kind'] == 'source_snapshot':
        return {key: 'applied' for key in envelope['payload']}
    if envelope['kind'] == 'reading_events':
        return {event['event_id']: 'applied' for event in envelope['payload']['events']}
    return {envelope['kind']: 'applied'}


def good_ack(envelope):
    return {'schema_version': 1, 'instance_id': envelope['instance_id'], 'device_id': envelope['device_id'],
            'reset_generation': envelope['reset_generation'], 'source_id': envelope['source_id'], 'seq': envelope['seq'],
            'kind': envelope['kind'], 'status': 'applied', 'results': results_for(envelope),
            'current_reset_generation': envelope['reset_generation']}


pairs = []


def add(envelope, change):
    ack = good_ack(envelope)
    change(ack)
    pairs.append((envelope, ack))


for envelope in envelopes:
    first = lambda ack: next(iter(ack['results']))
    add(envelope, lambda ack: None)
    add(envelope, lambda ack: ack.update(status='duplicate'))
    add(envelope, lambda ack: ack['results'].update({first(ack): 'duplicate'}))
    add(envelope, lambda ack: ack['results'].update({first(ack): 'stale'}))
    add(envelope, lambda ack: ack['results'].update({first(ack): 'discarded'}))
    add(envelope, lambda ack: ack['results'].pop(first(ack)))
    add(envelope, lambda ack: ack['results'].update({'extra': 'applied'}))
    add(envelope, lambda ack: ack.update(seq=ack['seq'] + 1))
    add(envelope, lambda ack: ack.update(instance_id=ack['device_id'] if ack['device_id'] != ack['instance_id'] else '00000000-0000-4000-8000-000000000000'))
    add(envelope, lambda ack: ack.update(device_id='00000000-0000-4000-8000-000000000000'))
    add(envelope, lambda ack: ack.update(source_id=None if ack['source_id'] else 'b' * 64))
    add(envelope, lambda ack: ack.update(reset_generation=ack['reset_generation'] + 1))
    add(envelope, lambda ack: ack.update(kind='vocabulary_snapshot' if ack['kind'] != 'vocabulary_snapshot' else 'legacy_statistics'))
    add(envelope, lambda ack: ack.update(status='bogus'))
    add(envelope, lambda ack: ack.update(status='obsolete_discarded', current_reset_generation=ack['reset_generation'] + 0.5,
                                         results={key: 'discarded' for key in ack['results']}))
    add(envelope, lambda ack: ack.update(current_reset_generation=str(ack['reset_generation'])))
    add(envelope, lambda ack: ack.update(schema_version=2))
    add(envelope, lambda ack: ack.update(unexpected=True))
    add(envelope, lambda ack: ack.update(current_reset_generation=ack['current_reset_generation'] + 1))
    add(envelope, lambda ack: ack.update(status='obsolete_discarded', current_reset_generation=ack['reset_generation'] + 1,
                                         results={key: 'discarded' for key in ack['results']}))
    add(envelope, lambda ack: ack.update(status='obsolete_discarded', current_reset_generation=ack['reset_generation'] + 1))
    add(envelope, lambda ack: ack.update(status='obsolete_discarded', results={key: 'discarded' for key in ack['results']}))
    add(envelope, lambda ack: ack.update(status='obsolete_discarded', current_reset_generation=ack['reset_generation'] + 1,
                                         results={**{key: 'discarded' for key in ack['results']}, 'extra': 'discarded'}))

script = '''import {matchesAck} from "./contracts/validate.js"; let s=""; for await (const c of process.stdin) s+=c;
console.log(JSON.stringify(JSON.parse(s).map(([e,a]) => matchesAck(e,a))));'''
expected = json.loads(subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(pairs), text=True,
                                     capture_output=True, check=True).stdout)
lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute('package.path="projects/plugin/?.lua;"..package.path')
codec = lua.eval('require("protocol.codec")')
acknowledged = lua.eval('require("delivery.delivery").acknowledged')
actual = []
for envelope, ack in pairs:
    packet = codec.decode(json.dumps(envelope, ensure_ascii=False))
    actual.append(acknowledged(codec.decode(json.dumps(ack, ensure_ascii=False)), packet) is not None)
assert actual == expected, [(i, expected[i], actual[i]) for i in range(len(pairs)) if expected[i] != actual[i]][:10]
assert any(expected) and not all(expected)
print(f'{len(pairs)} acknowledgement differential cases match the shared contract')
