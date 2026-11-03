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

test('new source receives a distinct book membership, existing metadata updates preserve it', async () => {
  const sources = new Set(), books = new Map(), memberships = new Map();
  const client = { async query(sql, args) {
    if (sql.startsWith('INSERT INTO sources')) { sources.add(args[0]); return { rows: [] }; }
    if (sql.startsWith('SELECT book_id FROM book_sources')) return { rows: memberships.has(args[0]) ? [{ book_id: memberships.get(args[0]) }] : [] };
    if (sql.startsWith('INSERT INTO books')) { books.set(args[0], args[1]); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO book_sources')) { memberships.set(args[0], args[1]); return { rows: [] }; }
    return { rows: [] };
  } };
  const tx = createSyncTx(client), metadata = fixtures.envelopes[0].payload.metadata.value;
  await tx.metadata('a'.repeat(64), metadata, 0); await tx.metadata('b'.repeat(64), metadata, 0);
  assert.equal(memberships.size, 2); assert.notEqual(memberships.get('a'.repeat(64)), memberships.get('b'.repeat(64)));
  const first = memberships.get('a'.repeat(64)); await tx.metadata('a'.repeat(64), metadata, 0);
  assert.equal(memberships.get('a'.repeat(64)), first); assert.equal(books.size, 2);
});

test('splitting selected sources creates one group and preserves source-owned data', async () => {
  const original = '48bc0344-efad-4c68-adb6-dc0f0ba57276', sources = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  const memberships = new Map(sources.map(source => [source, original])), books = new Map([[original, 'Synthetic']]);
  const annotations = new Map([[sources[1], ['synthetic annotation']]]);
  const client = { query: async (sql, args = []) => {
    if (sql.startsWith('SELECT book_id, title FROM books')) return { rows: books.has(args[0]) ? [{ book_id: args[0], title: books.get(args[0]) }] : [] };
    if (sql.startsWith('SELECT source_id FROM book_sources')) return { rows: [...memberships].filter(([, book]) => book === args[0]).map(([source_id]) => ({ source_id })) };
    if (sql.startsWith('INSERT INTO books')) { books.set(args[0], args[1]); return { rows: [] }; }
    if (sql.startsWith('UPDATE book_sources')) { for (const source of args[0]) memberships.set(source, args[1]); return { rows: [] }; }
    throw new Error('Unexpected query');
  } };
  const tx = createSyncTx(client);
  const result = await tx.splitSources?.(original, [sources[1], sources[2]]);
  assert.equal(result?.original, original); assert.ok(result?.created); assert.notEqual(result.created, original);
  assert.equal(memberships.get(sources[0]), original); assert.equal(memberships.get(sources[1]), result.created); assert.equal(memberships.get(sources[2]), result.created);
  assert.deepEqual(annotations.get(sources[1]), ['synthetic annotation']);
  await assert.rejects(tx.splitSources(original, [sources[0]]), error => error.code === 'nothing_to_split');
  await assert.rejects(tx.splitSources(original, [sources[1]]), error => error.code === 'source_not_in_book');
});

test('merging sources retains their data and removes empty groups', async () => {
  const target = '48bc0344-efad-4c68-adb6-dc0f0ba57276', old = 'cf451aa3-6d2d-42be-a859-8ac21da94732';
  const a = 'a'.repeat(64), b = 'b'.repeat(64), memberships = new Map([[a, target], [b, old]]), books = new Set([target, old]);
  const history = new Map([[b, ['synthetic event']]]);
  const client = { query: async (sql, args = []) => {
    if (sql.startsWith('SELECT book_id FROM books')) return { rows: books.has(args[0]) ? [{ book_id: args[0] }] : [] };
    if (sql.startsWith('SELECT source_id, book_id FROM book_sources')) return { rows: args[0].filter(id => memberships.has(id)).map(id => ({ source_id: id, book_id: memberships.get(id) })) };
    if (sql.startsWith('UPDATE book_sources')) { for (const id of args[0]) memberships.set(id, args[1]); return { rows: [] }; }
    if (sql.startsWith('DELETE FROM books')) { for (const id of args[0]) if (![...memberships.values()].includes(id)) books.delete(id); return { rows: [] }; }
    throw new Error('Unexpected query');
  } };
  const tx = createSyncTx(client), result = await tx.mergeSources?.(target, [b]);
  assert.equal(result, target); assert.equal(memberships.get(b), target); assert.equal(books.has(old), false); assert.deepEqual(history.get(b), ['synthetic event']);
  await assert.rejects(tx.mergeSources(target, ['c'.repeat(64)]), error => error.code === 'source_not_found');
});

test('vocabulary reset barrier permits saving a word after an empty baseline', async () => {
  const live = new Map(), tombstones = new Map();
  const client = { async query(sql, args = []) {
    if (sql === 'DELETE FROM vocabulary') live.clear();
    else if (sql.startsWith("INSERT INTO reset_tombstones") && sql.includes("'vocabulary'")) { for (const key of live.keys()) tombstones.set(key, null); }
    else if (sql.startsWith("SELECT 1 FROM reset_tombstones") && sql.includes("'vocabulary'")) return { rows: tombstones.has(args[1]) && tombstones.get(args[1]) === null ? [{}] : [] };
    else if (sql.startsWith("UPDATE reset_tombstones") && sql.includes("'vocabulary'")) { for (const key of tombstones.keys()) if (!args[0].includes(key)) tombstones.set(key, key); }
    else if (sql.startsWith('INSERT INTO vocabulary ')) live.set(args[0], JSON.parse(args[1]));
    return { rows: [] };
  } };
  const tx = createSyncTx(client), word = { word: 'synthetic', language: null, source: null };
  await tx.vocabulary([word]); await tx.clear(1); await tx.vocabulary([word]);
  assert.equal(live.size, 0);
  await tx.vocabulary([]); await tx.vocabulary([word]);
  assert.deepEqual([...live.values()], [word]);
  assert.equal(tombstones.size, 1); assert.equal([...tombstones.entries()][0][0], [...tombstones.entries()][0][1]);
});

test('vocabulary identity barrier survives case and source changes and a second reset', async () => {
  const { canonicalDigest } = await import('../../contracts/validate.js');
  const live = new Map(), barriers = new Map();
  const client = { async query(sql, args = []) {
    if (sql === 'DELETE FROM vocabulary') live.clear();
    else if (sql.startsWith("INSERT INTO reset_tombstones") && sql.includes("'vocabulary'")) for (const key of live.keys()) barriers.set(`vocabulary:${key}`, null);
    else if (sql.startsWith("INSERT INTO reset_tombstones") && sql.includes("'vocabulary_identity'")) for (const word of live.values()) barriers.set(`vocabulary_identity:${canonicalDigest([word.word.toLowerCase(), word.language?.toLowerCase() ?? null])}`, null);
    else if (sql.startsWith('UPDATE reset_tombstones') && sql.includes("'vocabulary_identity'")) { for (const key of barriers.keys()) if (key.startsWith('vocabulary_identity:') && !args[0].includes(key.slice(20))) barriers.set(key, key.slice(20)); }
    else if (sql.startsWith('UPDATE reset_tombstones') && sql.includes("'vocabulary'")) { for (const key of barriers.keys()) if (key.startsWith('vocabulary:') && !args[0].includes(key.slice(11))) barriers.set(key, key.slice(11)); }
    else if (sql.startsWith('SELECT 1 FROM reset_tombstones') && sql.includes("'vocabulary_identity'")) return { rows: barriers.get(`vocabulary_identity:${args[0]}`) === null || barriers.get(`vocabulary:${args[1]}`) === null ? [{}] : [] };
    else if (sql.startsWith('SELECT 1 FROM reset_tombstones') && sql.includes("'vocabulary'")) return { rows: barriers.get(`vocabulary:${args[0]}`) === null ? [{}] : [] };
    else if (sql.startsWith('SELECT word_key, content FROM vocabulary')) return { rows: [...live].map(([word_key, content]) => ({ word_key, content })) };
    else if (sql.startsWith('INSERT INTO vocabulary ')) live.set(args[0], JSON.parse(args[1]));
    return { rows: [] };
  } };
  const tx = createSyncTx(client), old = { word: 'Apple', language: 'en', source: 'one' }, changed = { word: 'apple', language: 'EN', source: 'two' };
  await tx.vocabulary([old]); await tx.clear(1); await tx.vocabulary([changed]); assert.equal(live.size, 0);
  await tx.vocabulary([old]); assert.equal(live.size, 0);
  await tx.vocabulary([]); await tx.vocabulary([changed]); assert.equal(live.size, 1);
  await tx.clear(2); await tx.vocabulary([old]); assert.equal(live.size, 0);
  await tx.vocabulary([]); await tx.vocabulary([old]); assert.equal(live.size, 1);
});
