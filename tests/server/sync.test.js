import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSyncService } from '../../server/sync.js';
const fixture = JSON.parse(readFileSync(new URL('../../contracts/examples/synthetic.json', import.meta.url)));
function memory(timezone = 'UTC') {
  let state = { generation: 0, packets: {}, events: {}, sections: {}, sources: {}, bindings: {}, values: {}, legacyBaselines: {}, vocabularyUnicode: null };
  const db = { async withTransaction(work) { const draft = structuredClone(state); const result = await work(draft); state = draft; return result; } };
  const tx = draft => ({
    async lock() { return { instance_id: fixture.envelopes[0].instance_id, reset_generation: draft.generation, reporting_timezone: timezone }; },
    async device(hash) { return { device_id: draft.bindings[hash] ?? null }; },
    async bind(hash, device) { if (draft.bindings[hash] && draft.bindings[hash] !== device.toLowerCase()) return false; draft.bindings[hash] = device.toLowerCase(); return true; },
    async packet(device, seq) { return draft.packets[`${device.toLowerCase()}:${seq}`]; },
    async savePacket(e, digest, ack) { draft.packets[`${e.device_id.toLowerCase()}:${e.seq}`] = { digest, ack }; },
    async source(id) { return draft.sources[id]; },
    async section(key) { return draft.sections[key]; },
    async saveSection(key, version, digest) { draft.sections[key] = { version, digest }; },
    async metadata(id, value) { draft.sources[id] = value; },
    async annotations(id, value) { draft.values[`${id}:annotations`] = value; },
    async progress(id, value) { draft.values[`${id}:progress`] = value; },
    async event(id) { return draft.events[id]; },
    async saveEvent(event, digest) { draft.events[event.event_id] = { digest }; },
    async vocabulary(value) { draft.values.vocabulary = value; },
    async vocabularyUnicode() { return { version: draft.vocabularyUnicode, unknown: false }; },
    async rememberVocabularyUnicode(version) { draft.vocabularyUnicode = version; },
    async legacy(id, value) { draft.values[`${id}:legacy`] = value; },
    async legacyBaseline(device, source, generation) { return draft.legacyBaselines[`${device}:${source}:${generation}`]; },
    async establishLegacyBaseline(device, source, generation, baselineId, digest, records, nativeEpoch) { draft.legacyBaselines[`${device}:${source}:${generation}`] = { baseline_id: baselineId, digest, native_epoch: nativeEpoch }; draft.values[`${source}:baseline`] = records; },
    async touch() {},
  });
  return { db, tx, state: () => state, reset() { state.generation++; state.sources = {}; state.sections = {}; state.values = {}; } };
}
test('sync retry survives a new service instance and rejects conflicting sequence content atomically', async () => {
  const m = memory(), packet = structuredClone(fixture.envelopes[0]);
  const service = createSyncService({ db: m.db, createTx: m.tx });
  const first = await service.ingest('synthetic-token', packet);
  assert.equal(first.results.metadata, 'applied');
  assert.deepEqual(await createSyncService({ db: m.db, createTx: m.tx }).ingest('synthetic-token', packet), first);
  const changed = structuredClone(packet); changed.payload.metadata.value.title = 'Different synthetic';
  await assert.rejects(service.ingest('synthetic-token', changed), error => error.status === 409);
  assert.equal(m.state().sources[packet.source_id].title, 'Synthetic Book');
});
test('unknown source rejects before binding and old queued packets receive discard acknowledgements', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  const event = structuredClone(fixture.envelopes[3]);
  await assert.rejects(service.ingest('synthetic-token', event), error => error.code === 'source_metadata_required');
  assert.deepEqual(m.state().bindings, {});
  m.reset(); const ack = await service.ingest('synthetic-token', event);
  assert.equal(ack.status, 'obsolete_discarded'); assert.equal(ack.current_reset_generation, 1);
  assert.deepEqual(Object.values(ack.results), ['discarded']);
});
test('snapshot sections order independently and reject equal-version changes', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  const source = structuredClone(fixture.envelopes[0]); await service.ingest('token', source);
  const metadata = { ...structuredClone(source), seq: 2, payload: { metadata: { version: 5, value: { ...source.payload.metadata.value, title: 'New' } } } };
  await service.ingest('token', metadata);
  const stale = { ...structuredClone(source), seq: 3 };
  const ack = await service.ingest('token', stale); assert.equal(ack.results.metadata, 'stale'); assert.equal(ack.results.annotations, 'duplicate');
  const collision = { ...structuredClone(metadata), seq: 4 }; collision.payload.metadata.value.title = 'Conflict';
  await assert.rejects(service.ingest('token', collision), error => error.code === 'section_conflict');
  assert.equal(m.state().sources[source.source_id].title, 'New');
});
test('event identities are independent of packet sequence and reject changed events', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  await service.ingest('token', structuredClone(fixture.envelopes[0]));
  const batch = structuredClone(fixture.envelopes[3]);
  assert.equal(Object.values((await service.ingest('token', batch)).results)[0], 'applied');
  assert.equal(Object.values((await service.ingest('token', { ...batch, seq: 20 })).results)[0], 'duplicate');
  const conflict = structuredClone(batch); conflict.seq = 21; conflict.payload.events[0].native_seconds = 11; conflict.payload.events[0].allocation[1].seconds++;
  await assert.rejects(service.ingest('token', conflict), error => error.code === 'event_conflict');
});
test('existing source rejects locator engines or metadata format inconsistent with its immutable format', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  const packet = structuredClone(fixture.envelopes[0]); await service.ingest('token', packet);
  const wrong = { ...structuredClone(packet), seq: 2, payload: { metadata: { version: 2, value: { ...packet.payload.metadata.value, format: 'pdf' } } } };
  await assert.rejects(service.ingest('token', wrong), error => error.code === 'source_format_conflict');
});
import { legacyUpdate } from '../../server/legacy.js';
test('legacy high-water deltas remain correct through repeated snapshots and two resets', () => {
  let raw = { pages: 100, seconds: 100 }, baseline = { ...raw }, live = { pages: 0, seconds: 0 };
  ({ raw, live } = legacyUpdate({ pages: 110, seconds: 108 }, raw, baseline, live));
  assert.deepEqual(live, { pages: 10, seconds: 8 });
  ({ raw, live } = legacyUpdate({ pages: 110, seconds: 108 }, raw, baseline, live));
  assert.deepEqual(live, { pages: 10, seconds: 8 });
  baseline = { ...raw }; live = { pages: 0, seconds: 0 };
  ({ raw, live } = legacyUpdate({ pages: 112, seconds: 111 }, raw, baseline, live));
  assert.deepEqual(live, { pages: 2, seconds: 3 });
  ({ raw, live } = legacyUpdate({ pages: 2, seconds: 1 }, raw, baseline, live));
  assert.deepEqual(live, { pages: 2, seconds: 3 });
});
import { createResetService } from '../../server/reset.js';
test('reset increments generation atomically while retaining identity barriers', async () => {
  let state = { generation: 0, identities: ['synthetic-id'], live: ['synthetic-content'] };
  const db = { withTransaction: async work => { const draft = structuredClone(state); const result = await work({ lock: async () => ({ reset_generation: draft.generation }), clear: async generation => { draft.generation = generation; draft.live = []; } }); state = draft; return result; } };
  const reset = createResetService({ db, createTx: client => client });
  assert.deepEqual(await reset({ confirm: 'reset' }), { reset_generation: 1 });
  assert.deepEqual(state.identities, ['synthetic-id']); assert.deepEqual(state.live, []);
  await assert.rejects(reset({ confirm: 'no' }), error => error.status === 400);
});
test('uppercase UUID identity is accepted and retry matches canonical database device UUID', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  const packet = structuredClone(fixture.envelopes[0]);
  packet.instance_id = packet.instance_id.toUpperCase(); packet.device_id = packet.device_id.toUpperCase();
  const ack = await service.ingest('token', packet);
  assert.equal(ack.instance_id, packet.instance_id); assert.equal(ack.device_id, packet.device_id);
  assert.deepEqual(await service.ingest('token', packet), ack);
});
test('event IDs differing only in UUID case are duplicate identities and rejected', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  const packet = structuredClone(fixture.envelopes[3]);
  const second = structuredClone(packet.payload.events[0]); second.event_id = second.event_id.toUpperCase();
  packet.payload.events.push(second);
  await assert.rejects(service.ingest('token', packet), error => error.code === 'invalid_envelope');
  assert.deepEqual(m.state().bindings, {});
});
test('reset preserves packet conflicts and immutable event barriers across new generation', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  const source = structuredClone(fixture.envelopes[0]), batch = structuredClone(fixture.envelopes[3]);
  await service.ingest('token', source); await service.ingest('token', batch); m.reset();
  const altered = structuredClone(batch); altered.captured_at = '2024-03-01T00:00:00Z';
  await assert.rejects(service.ingest('token', altered), error => error.code === 'packet_conflict');
  assert.equal((await service.ingest('token', batch)).status, 'obsolete_discarded');
  const newSource = { ...source, seq: 90, reset_generation: 1 }; await service.ingest('token', newSource);
  const replay = { ...batch, seq: 91, reset_generation: 1 };
  assert.equal(Object.values((await service.ingest('token', replay)).results)[0], 'duplicate');
});
import { createHash } from 'node:crypto';
test('authorization, instance, future generation and malformed packets reject before persisted changes', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx }), packet = structuredClone(fixture.envelopes[0]);
  await assert.rejects(service.ingest('', packet), error => error.status === 401);
  await assert.rejects(service.ingest('token', {}), error => error.status === 400);
  await assert.rejects(service.ingest('token', { ...packet, instance_id: 'a92e58b4-851b-467b-a5ad-1eaaccc84c61' }), error => error.status === 403);
  await assert.rejects(service.ingest('token', { ...packet, reset_generation: 1 }), error => error.status === 409);
  m.state().bindings[createHash('sha256').update('token').digest('hex')] = 'a92e58b4-851b-467b-a5ad-1eaaccc84c61';
  await assert.rejects(service.ingest('token', packet), error => error.code === 'device_mismatch');
  assert.deepEqual(m.state().sources, {});
});
test('vocabulary and legacy snapshots are independently versioned and deduplicated', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  await service.ingest('token', structuredClone(fixture.envelopes[0]));
  for (const original of [fixture.envelopes[4], fixture.envelopes[5]]) {
    const packet = structuredClone(original), key = packet.kind;
    if (key === 'legacy_statistics') {
      const baseline = { ...structuredClone(packet), seq: 99, payload: { mode: 'baseline', baseline_id: packet.instance_id, native_epoch: packet.instance_id, version: 1, records: [] } };
      await service.ingest('token', baseline);
      packet.payload.mode = 'snapshot'; packet.payload.baseline_id = packet.instance_id; packet.payload.native_epoch = packet.instance_id;
    }
    assert.equal((await service.ingest('token', packet)).results[key], 'applied');
    assert.equal((await service.ingest('token', { ...packet, seq: packet.seq + 50 })).results[key], 'duplicate');
  }
});

test('rejects incorrect time allocation before persisting an event', async () => {
  const m = memory(), service = createSyncService({ db: m.db, createTx: m.tx });
  await service.ingest('token', structuredClone(fixture.envelopes[0]));
  const batch = structuredClone(fixture.envelopes[3]);
  batch.payload.events[0].allocation = [{ date: '2024-02-28', seconds: 5 }, { date: '2024-02-29', seconds: 5 }];
  await assert.rejects(service.ingest('token', batch), error => error.code === 'invalid_allocation');
  assert.deepEqual(m.state().events, {});
});


test('allocation handles exact fractional ties, local midnight, DST and anchor date', async () => {
  const { validAllocation } = await import('../../server/allocation.js');
  const base = structuredClone(fixture.envelopes[3].payload.events[0]);
  const check = (changes, zone, expected = true) => assert.equal(validAllocation({ ...base, ...changes }, zone), expected);
  check({ native_seconds: 1, awake_windows: [{ start: '2024-02-28T23:59:59.999999999Z', end: '2024-02-29T00:00:00.000000001Z' }], allocation: [{ date: '2024-02-28', seconds: 1 }, { date: '2024-02-29', seconds: 0 }] }, 'UTC');
  check({ native_seconds: 2, awake_windows: [{ start: '2024-03-10T04:59:59Z', end: '2024-03-10T05:00:01Z' }], allocation: [{ date: '2024-03-09', seconds: 1 }, { date: '2024-03-10', seconds: 1 }] }, 'America/New_York');
  check({ native_seconds: 47, awake_windows: [{ start: '2024-03-09T05:00:00Z', end: '2024-03-11T04:00:00Z' }], allocation: [{ date: '2024-03-09', seconds: 24 }, { date: '2024-03-10', seconds: 23 }] }, 'America/New_York');
  check({ timing_quality: 'estimated_native_anchor', native_seconds: 0, native_anchor: '2024-03-10T04:59:59Z', awake_windows: [], allocation: [{ date: '2024-03-09', seconds: 0 }] }, 'America/New_York');
  check({ timing_quality: 'estimated_native_anchor', native_seconds: 0, native_anchor: '2024-03-10T04:59:59Z', awake_windows: [], allocation: [{ date: '2024-03-10', seconds: 0 }] }, 'America/New_York', false);
  check({ native_seconds: 1, awake_windows: [{ start: '1969-12-31T23:59:59.9Z', end: '1970-01-01T00:00:00.1Z' }], allocation: [{ date: '1969-12-31', seconds: 1 }, { date: '1970-01-01', seconds: 0 }] }, 'UTC');
});

test('allocation rejects out-of-range local years and accepts 366 touched days only', async () => {
  const { validAllocation } = await import('../../server/allocation.js');
  const base = structuredClone(fixture.envelopes[3].payload.events[0]);
  assert.equal(validAllocation({ ...base, timing_quality: 'estimated_native_anchor', native_seconds: 0, native_anchor: '0001-01-01T00:00:00Z', awake_windows: [], allocation: [{ date: '0001-12-31', seconds: 0 }] }, 'America/New_York'), false);
  const dates = Array.from({ length: 366 }, (_, i) => ({ date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), seconds: 0 }));
  const event = { ...base, native_seconds: 0, awake_windows: [{ start: '2024-01-01T00:00:00Z', end: '2025-01-01T00:00:00Z' }], allocation: dates };
  assert.equal(validAllocation(event, 'UTC'), true);
  assert.equal(validAllocation({ ...event, awake_windows: [{ start: '2024-01-01T00:00:00Z', end: '2025-01-02T00:00:00Z' }] }, 'UTC'), false);
});

test('local date outside supported years is rejected before event persistence', async () => {
  const m = memory('America/New_York'), service = createSyncService({ db: m.db, createTx: m.tx });
  await service.ingest('token', structuredClone(fixture.envelopes[0]));
  const packet = structuredClone(fixture.envelopes[3]), event = packet.payload.events[0];
  Object.assign(event, { timing_quality: 'estimated_native_anchor', native_seconds: 0, native_anchor: '0001-01-01T00:00:00Z', awake_windows: [], allocation: [{ date: '0001-12-31', seconds: 0 }] });
  await assert.rejects(service.ingest('token', packet), error => error.status === 400 && error.code === 'invalid_allocation');
  assert.deepEqual(m.state().events, {});
});

test('a one-minute local-date excursion is allocated and validated before ingestion', async () => {
  const { validAllocation } = await import('../../server/allocation.js');
  const m = memory('America/St_Johns'), service = createSyncService({ db: m.db, createTx: m.tx });
  await service.ingest('token', structuredClone(fixture.envelopes[0]));
  const packet = structuredClone(fixture.envelopes[3]), event = packet.payload.events[0];
  Object.assign(event, { native_seconds: 3600, awake_windows: [{ start: '1988-10-30T01:00:00Z', end: '1988-10-30T02:00:00Z' }], allocation: [{ date: '1988-10-29', seconds: 3540 }, { date: '1988-10-30', seconds: 60 }] });
  assert.equal(validAllocation(event, 'America/St_Johns'), true);
  const wrong = structuredClone(packet); wrong.seq++; wrong.payload.events[0].allocation = [{ date: '1988-10-29', seconds: 3600 }];
  assert.equal(validAllocation(wrong.payload.events[0], 'America/St_Johns'), false);
  await assert.rejects(service.ingest('token', wrong), e => e.code === 'invalid_allocation');
  assert.deepEqual(m.state().events, {});
  assert.equal(Object.values((await service.ingest('token', packet)).results)[0], 'applied');
});

test('a rollback into the previous date followed by midnight preserves both allocations', async () => {
  const { validAllocation } = await import('../../server/allocation.js');
  const event = structuredClone(fixture.envelopes[3].payload.events[0]);
  Object.assign(event, { native_seconds: 3600, awake_windows: [{ start: '1987-10-25T03:00:00Z', end: '1987-10-25T04:00:00Z' }], allocation: [{ date: '1987-10-24', seconds: 3540 }, { date: '1987-10-25', seconds: 60 }] });
  assert.equal(validAllocation(event, 'America/Goose_Bay'), true);
  event.allocation = [{ date: '1987-10-25', seconds: 3600 }];
  assert.equal(validAllocation(event, 'America/Goose_Bay'), false);
});

test('large valid sets of subsecond windows do not exhaust function arguments', async () => {
  const { validAllocation } = await import('../../server/allocation.js');
  const event = structuredClone(fixture.envelopes[3].payload.events[0]);
  const stamp = n => `2024-02-29T00:00:00.${String(n).padStart(9, '0')}Z`;
  Object.assign(event, { native_seconds: 1, awake_windows: Array.from({ length: 70000 }, (_, i) => ({ start: stamp(i * 2), end: stamp(i * 2 + 1) })), allocation: [{ date: '2024-02-29', seconds: 1 }] });
  assert.equal(validAllocation(event, 'UTC'), true);
});

test('all history event reporting dates remain within the local date domain', async () => {
  for (const [zone, occurred_at] of [['America/New_York', '0001-01-01T00:00:00Z'], ['Pacific/Kiritimati', '9999-12-31T23:59:59Z']]) {
    const m = memory(zone), service = createSyncService({ db: m.db, createTx: m.tx });
    await service.ingest('token', structuredClone(fixture.envelopes[0]));
    const packet = structuredClone(fixture.envelopes[3]), segment = packet.payload.events[0];
    Object.assign(segment, { occurred_at, timing_quality: 'unavailable', native_seconds: null, native_record_id: null, provenance: null, awake_windows: [], native_anchor: null, allocation: [] });
    await assert.rejects(service.ingest('token', packet), error => error.code === 'invalid_allocation');
    const lifecycle = { event_id: segment.event_id, source_id: segment.source_id, session_id: segment.session_id, occurred_at, type: 'session_started', cycle_id: segment.session_id };
    packet.payload.events = [lifecycle];
    await assert.rejects(service.ingest('token', packet), error => error.code === 'invalid_allocation');
    assert.deepEqual(m.state().events, {});
  }
});

test('legacy reset handshake requires baseline before raw snapshots and preserves retry identity', async () => {
  const m = memory(), source = structuredClone(fixture.envelopes[0]), old = structuredClone(fixture.envelopes[5]);
  const service = createSyncService({ db: m.db, createTx: m.tx }); await service.ingest('token', source);
  const oldAck = await service.ingest('token', old);
  assert.equal(oldAck.results.legacy_statistics, 'applied');
  assert.deepEqual(await service.ingest('token', old), oldAck);
  const baseline = { ...structuredClone(old), seq: 100, payload: { mode: 'baseline', baseline_id: '48bc0344-efad-4c68-adb6-dc0f0ba57276', native_epoch: 'a92e58b4-851b-467b-a5ad-1eaaccc84c61', version: 1, records: [{ date: '2024-02-29', native_pages: 100, native_seconds: 100 }] } };
  const missingEpoch = structuredClone(baseline); delete missingEpoch.payload.native_epoch;
  await assert.rejects(service.ingest('token', missingEpoch), e => e.code === 'invalid_envelope');
  const snapshot = { ...structuredClone(baseline), seq: 101, payload: { ...baseline.payload, mode: 'snapshot', version: 1, records: [{ date: '2024-02-29', native_pages: 110, native_seconds: 110 }] } };
  await assert.rejects(service.ingest('token', snapshot), e => e.code === 'legacy_baseline_required');
  const ack = await service.ingest('token', baseline); assert.equal(ack.results.legacy_statistics, 'applied');
  assert.deepEqual(await service.ingest('token', baseline), ack);
  const changed = structuredClone(baseline); changed.seq++; changed.payload.records[0].native_pages++;
  await assert.rejects(service.ingest('token', changed), e => e.code === 'legacy_baseline_conflict');
  assert.equal((await service.ingest('token', snapshot)).results.legacy_statistics, 'applied');
  assert.deepEqual(m.state().values[`${source.source_id}:legacy`], snapshot.payload.records);
  const wrong = structuredClone(snapshot); wrong.seq++; wrong.payload.baseline_id = 'a92e58b4-851b-467b-a5ad-1eaaccc84c61';
  await assert.rejects(service.ingest('token', wrong), e => e.code === 'legacy_baseline_conflict');
  const changedEpoch = structuredClone(snapshot); changedEpoch.seq++; changedEpoch.payload.native_epoch = baseline.payload.baseline_id;
  await assert.rejects(service.ingest('token', changedEpoch), e => e.code === 'legacy_epoch_conflict');
  m.reset(); assert.equal((await service.ingest('token', snapshot)).status, 'obsolete_discarded');
  const newSource = structuredClone(source); newSource.seq = 199; newSource.reset_generation = 1;
  await service.ingest('token', newSource);
  const unsafe = structuredClone(old); unsafe.seq = 200; unsafe.reset_generation = 1;
  await assert.rejects(service.ingest('token', unsafe), e => e.code === 'legacy_upgrade_required');
});

test('post-reset vocabulary packets require the server Unicode version', async () => {
  const m=memory(), service=createSyncService({db:m.db,createTx:m.tx});
  m.reset();
  const packet=structuredClone(fixture.envelopes[4]); packet.seq=300; packet.reset_generation=1;
  await assert.rejects(service.ingest('token',packet),e=>e.code==='unicode_version_mismatch');
  packet.payload.unicode_version='0.0';
  await assert.rejects(service.ingest('token',packet),e=>e.code==='unicode_version_mismatch');
  packet.payload.unicode_version=process.versions.unicode;
  assert.equal((await service.ingest('token',packet)).results.vocabulary_snapshot,'applied');
  m.state().vocabularyUnicode='0.0';
  const later=structuredClone(packet); later.seq++;
  await assert.rejects(service.ingest('token',later),e=>e.code==='unicode_version_mismatch');
  assert.equal((await service.ingest('token',packet)).results.vocabulary_snapshot,'applied');
});
