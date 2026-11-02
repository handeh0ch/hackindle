import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncTx } from '../../server/sync-store.js';
import { readFileSync } from 'node:fs';
const fixtures = JSON.parse(readFileSync(new URL('../../contracts/examples/synthetic.json', import.meta.url)));
function annotationDB() {
  const annotations = new Map(), identities = new Map(), versions = [];
  const client = { async query(sql, args = []) {
    if (sql.startsWith('SELECT annotation_id, version')) return { rows: [...annotations.values()].filter(a => a.source_id === args[0]) };
    if (sql.startsWith('SELECT source_id, digest, barrier_generation')) { const value = identities.get(args[0].toLowerCase()); return { rows: value ? [value] : [] }; }
    if (sql.startsWith('INSERT INTO annotation_identities')) { identities.set(args[0].toLowerCase(), { source_id: args[1], digest: args[2], barrier_generation: null, content_version: args[3] }); return { rows: [] }; }
    if (sql.startsWith('UPDATE annotation_identities SET content_version')) { identities.get(args[0].toLowerCase()).content_version = args[1]; return { rows: [] }; }
    if (sql.startsWith('UPDATE annotation_identities SET barrier_generation')) { for (const value of identities.values()) value.barrier_generation = args[0]; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO annotations ')) { annotations.set(args[1].toLowerCase(), { source_id: args[0], annotation_id: args[1].toLowerCase(), version: args[2], archived: false, content: JSON.parse(args[3]) }); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO annotation_versions')) { versions.push(args); return { rows: [] }; }
    if (sql.startsWith('UPDATE annotations SET archived')) { const value = annotations.get(args[1].toLowerCase()); value.archived = true; value.version = args[2]; return { rows: [] }; }
    return { rows: [] };
  } };
  return { client, annotations, identities, versions };
}
test('archive and reactivation preserve content and reject cross-source annotation UUID reuse', async () => {
  const m = annotationDB(), tx = createSyncTx(m.client), a = structuredClone(fixtures.envelopes[0].payload.annotations.value[0]);
  await tx.annotations('a'.repeat(64), [a]); await tx.annotations('a'.repeat(64), []);
  assert.equal(m.annotations.get(a.annotation_id).archived, true);
  assert.equal(m.annotations.get(a.annotation_id).content.context.reason, 'Synthetic extraction unavailable');
  await tx.annotations('a'.repeat(64), [a]); assert.equal(m.annotations.get(a.annotation_id).archived, false);
  assert.equal(m.annotations.get(a.annotation_id).version, 3); assert.equal(m.versions.length, 3);
  await assert.rejects(tx.annotations('b'.repeat(64), [a]), error => error.code === 'annotation_id_conflict');
});
test('reset annotation barrier suppresses unchanged body and context backfill, but permits a changed note', async () => {
  const m = annotationDB(), tx = createSyncTx(m.client), a = structuredClone(fixtures.envelopes[0].payload.annotations.value[0]);
  await tx.annotations('a'.repeat(64), [a]); const identity = m.identities.get(a.annotation_id); identity.barrier_generation = 1; m.annotations.clear();
  await tx.annotations('a'.repeat(64), [{ ...a, annotation_id: a.annotation_id.toUpperCase(), context: { status: 'unavailable', reason: 'later' } }]);
  assert.equal(m.annotations.size, 0);
  await tx.annotations('a'.repeat(64), [{ ...a, note: 'Edited after baseline' }]); assert.equal(m.annotations.size, 1);
});
test('transaction adapter maps persisted packet, section, event and upload records', async () => {
  const writes = [];
  const client = { async query(sql, args = []) {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: 'instance', reset_generation: '2' }] };
    if (sql.startsWith('SELECT device_id')) return { rows: [{ device_id: 'device' }] };
    if (sql.startsWith('UPDATE device SET device_id')) return { rows: [{ device_id: 'device' }] };
    if (sql.startsWith('SELECT digest, acknowledgement')) return { rows: [{ digest: 'packet-digest', ack: { seq: 1 } }] };
    if (sql.startsWith('SELECT metadata')) return { rows: [{ metadata: { format: 'epub' } }] };
    if (sql.startsWith('SELECT version, digest')) return { rows: [{ version: '3', digest: 'section-digest' }] };
    if (sql.startsWith('SELECT digest FROM event_identities')) return { rows: [{ digest: 'event-digest' }] };
    if (sql.startsWith('SELECT manifest')) return { rows: [{ manifest: { seq: 1 }, expires_at: new Date('2024-01-01T00:00:00Z'), committed_ack: null }] };
    if (sql.startsWith('SELECT digest FROM upload_chunks')) return { rows: [{ digest: 'chunk-digest' }] };
    if (sql.startsWith('SELECT COALESCE(sum')) return { rows: [{ bytes: '2' }] };
    if (sql.startsWith('SELECT count(*) AS count, min')) return { rows: [{ count: '1', min: 0, max: 0, bytes: Buffer.from('ab') }] };
    if (sql.startsWith('SELECT count(*) AS count FROM uploads')) return { rows: [{ count: '1' }] };
    if (sql.startsWith("SELECT 1 FROM reset_tombstones")) return { rows: [] };
    writes.push(args); return { rows: [] };
  } };
  const tx = createSyncTx(client), e = fixtures.envelopes[0], event = fixtures.envelopes[3].payload.events[0];
  assert.equal((await tx.lock()).reset_generation, '2'); assert.equal((await tx.device('hash')).device_id, 'device');
  assert.equal(await tx.bind('hash', 'device'), true); assert.equal((await tx.packet('device', 1)).ack.seq, 1);
  await tx.savePacket(e, 'hash', { seq: 1 }); assert.equal((await tx.source(e.source_id)).format, 'epub');
  const sourceKey = JSON.stringify([e.device_id, e.source_id, 'metadata', 0]), vocabKey = JSON.stringify([e.device_id, null, 'vocabulary_snapshot', 0]);
  assert.equal((await tx.section(sourceKey)).digest, 'section-digest'); assert.equal((await tx.section(vocabKey)).version, '3');
  await tx.saveSection(sourceKey, 4, 'digest'); await tx.saveSection(vocabKey, 4, 'digest');
  await tx.metadata(e.source_id, e.payload.metadata.value, 0); await tx.progress(e.source_id, { fraction: 0.5 });
  assert.equal((await tx.event(event.event_id)).digest, 'event-digest'); await tx.saveEvent(event, 'digest', e, 0);
  await tx.vocabulary([{ word: 'synthetic', language: null, source: null }]); await tx.touch();
  await tx.prune(Date.UTC(2024, 0, 1)); assert.equal(await tx.countOpen(e.device_id), 1);
  const manifest = { ...e, byte_length: 2, sha256: 'a'.repeat(64), chunk_count: 1 };
  await tx.insertUpload('id', manifest, Date.UTC(2024, 0, 2)); assert.equal((await tx.upload('id')).manifest.seq, 1);
  assert.equal((await tx.chunk('id', 0)).digest, 'chunk-digest'); assert.equal(await tx.chunkBytes('id'), 2);
  await tx.insertChunk('id', 0, 'digest', Buffer.from('ab')); assert.equal((await tx.assemble('id')).bytes.toString(), 'ab');
  await tx.completeUpload('id', { seq: 1 }); assert.ok(writes.some(args => args[0] === e.device_id && args[1] === e.seq && args[3] === 'hash' && JSON.parse(args[4]).seq === 1));
});
test('reset adapter removes live tables while retaining identity and raw high-water barriers', async () => {
  const statements = [];
  const tx = createSyncTx({ query: async (sql, args = []) => { statements.push({ sql, args }); return { rows: [] }; } });
  await tx.clear(2);
  assert.ok(statements.some(item => item.sql.startsWith('UPDATE instance SET reset_generation') && item.args[0] === 2));
  assert.ok(statements.some(item => item.sql === 'DELETE FROM annotations'));
  assert.equal(statements.some(item => item.sql === 'DELETE FROM event_identities' || item.sql === 'DELETE FROM packets' || item.sql === 'DELETE FROM legacy_raw_highwater'), false);
});
test('legacy adapter keeps cumulative raw baseline across two resets', async () => {
  let raw, baseline, live;
  const db = { query: async (sql, args = []) => {
    if (sql.startsWith('SELECT native_pages') && sql.includes('FROM legacy_raw_highwater')) return { rows: raw ? [raw] : [] };
    if (sql.startsWith('SELECT native_pages') && sql.includes('FROM legacy_reset_baseline')) return { rows: baseline ? [baseline] : [] };
    if (sql.startsWith('SELECT native_pages') && sql.includes('FROM legacy_statistics')) return { rows: live ? [live] : [] };
    if (sql.startsWith('INSERT INTO legacy_raw_highwater')) raw = { native_pages: args[2], native_seconds: args[3] };
    if (sql.startsWith('INSERT INTO legacy_statistics')) live = { native_pages: args[2], native_seconds: args[3] };
    if (sql === 'DELETE FROM legacy_reset_baseline') baseline = undefined;
    if (sql.startsWith('INSERT INTO legacy_reset_baseline SELECT')) baseline = raw ? { ...raw } : undefined;
    if (sql === 'DELETE FROM legacy_statistics') live = undefined;
    return { rows: [] };
  } };
  const tx = createSyncTx(db), source = 'a'.repeat(64);
  const record = pages => [{ date: '2024-02-29', native_pages: pages, native_seconds: pages }];
  await tx.legacy(source, record(100)); await tx.clear(1); await tx.legacy(source, record(110));
  assert.equal(live.native_pages, 10); await tx.legacy(source, record(110)); assert.equal(live.native_pages, 10);
  await tx.clear(2); await tx.legacy(source, record(112)); assert.equal(live.native_pages, 2);
});

test('ready context survives unchanged selection and reactivation; changed selection and backfill can capture', async () => {
  const m = annotationDB(), tx = createSyncTx(m.client), a = structuredClone(fixtures.envelopes[0].payload.annotations.value[0]);
  const ready = { status: 'ready', origin: 'creation', captured_at: '2024-02-29T00:00:00Z', page_basis: 'rendered', total_pages: 1, before: null, selection_pages: [{ number: 1, text: 'original' }], after: null };
  const source = 'a'.repeat(64), get = () => m.annotations.get(a.annotation_id).content;
  await tx.annotations(source, [{ ...a, context: ready }]);
  await tx.annotations(source, [{ ...a, note: 'edited', context: { status: 'pending', reason: 'retry' } }]);
  assert.deepEqual(get().context, ready);
  await tx.annotations(source, []); await tx.annotations(source, [{ ...a, context: { status: 'pending', reason: 'retry' } }]);
  assert.deepEqual(get().context, ready);
  const changed = { ...a, start: { ...a.start, value: '/synthetic/new' }, context: { status: 'pending', reason: 'new' } };
  await tx.annotations(source, [changed]); assert.equal(get().context.status, 'pending');
  const backfill = { ...ready, origin: 'backfill' };
  await tx.annotations(source, [{ ...changed, context: backfill }]); assert.deepEqual(get().context, backfill);
});

test('annotation version remains monotonic after reset and invalidates old cursor and explicit version', async () => {
  const m = annotationDB(), tx = createSyncTx(m.client), a = structuredClone(fixtures.envelopes[0].payload.annotations.value[0]), source = 'a'.repeat(64);
  const { createContentService } = await import('../../server/content.js');
  const content = createContentService({ query: async () => ({ rows: [...m.annotations.values()] }) });
  await tx.annotations(source, [{ ...a, quote: 'a'.repeat(300000) }]);
  const old = await content.content(a.annotation_id, { field: 'quote' });
  await tx.clear(1); m.annotations.clear();
  await tx.annotations(source, [{ ...a, note: 'post baseline edit' }]);
  await assert.rejects(content.content(a.annotation_id, { field: 'quote', cursor: old.next_cursor }), e => e.code === 'content_changed');
  await assert.rejects(content.content(a.annotation_id, { field: 'quote', version: old.version }), e => e.code === 'content_changed');
});
