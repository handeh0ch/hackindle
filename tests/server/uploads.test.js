import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createUploadService } from '../../server/uploads.js';
const example = JSON.parse(readFileSync(new URL('../../contracts/examples/synthetic.json', import.meta.url))).envelopes[0];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function memory() {
  let state = { uploads: {}, binding: null }, now = Date.UTC(2024, 0, 1), counter = 0;
  const db = { async withTransaction(work) { const draft = structuredClone(state); const result = await work(draft); state = draft; return result; } };
  const tx = draft => ({
    async lock() { return { instance_id: example.instance_id, reset_generation: 0 }; },
    async device() { return { device_id: draft.binding }; },
    async bind(hash, id) { if (draft.binding && draft.binding !== id) return false; draft.binding = id; return true; },
    async prune(at) { for (const u of Object.values(draft.uploads)) if (u.expires <= at) { u.gone = true; u.chunks = {}; } },
    async countOpen() { return Object.values(draft.uploads).filter(u => !u.gone && !u.ack).length; },
    async insertUpload(id, manifest, expires) { draft.uploads[id] = { manifest, expires, chunks: {} }; },
    async findOpen(manifest) {
      const found = Object.entries(draft.uploads).filter(([, u]) => !u.gone && !u.ack && u.manifest.device_id === manifest.device_id && u.manifest.source_id === manifest.source_id
        && u.manifest.seq === manifest.seq && u.manifest.reset_generation === manifest.reset_generation).map(([id, u]) => ({ upload_id: id, manifest: u.manifest, expires: u.expires }));
      return found;
    },
    async upload(id) { return draft.uploads[id]; },
    async chunk(id, index) { return draft.uploads[id].chunks[index]; },
    async chunkBytes(id) { return Object.values(draft.uploads[id].chunks).reduce((n, c) => n + c.bytes.length, 0); },
    async insertChunk(id, index, digest, bytes) { draft.uploads[id].chunks[index] = { digest, bytes }; },
    async assemble(id) { const chunks = draft.uploads[id].chunks, indices = Object.keys(chunks).map(Number).sort((a,b) => a-b); return { count: indices.length, min: indices[0], max: indices.at(-1), bytes: Buffer.concat(indices.map(i => Buffer.from(chunks[i].bytes))) }; },
    async completeUpload(id, ack) { draft.uploads[id].ack = ack; },
  });
  return { db, tx, now: () => now, advance(ms) { now += ms; }, uuid: () => `upload-${++counter}` };
}
function input() {
  const packet = structuredClone(example); packet.payload.metadata.value.title = 'Synthetic Ё';
  const bytes = Buffer.from(JSON.stringify(packet)); const split = bytes.indexOf(Buffer.from('Ё')) + 1;
  const chunks = [bytes.subarray(0, split), bytes.subarray(split)];
  const manifest = { schema_version: 1, instance_id: packet.instance_id, device_id: packet.device_id, source_id: packet.source_id, reset_generation: packet.reset_generation, seq: packet.seq, kind: packet.kind, byte_length: bytes.length, sha256: sha(bytes), chunk_count: chunks.length };
  return { packet, chunks, manifest };
}
test('upload resumes across chunks, decodes UTF-8 after assembly and repeats commit safely', async () => {
  const m = memory(), { packet, chunks, manifest } = input(); let applied = 0;
  const uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async (tx, token, value) => { applied++; assert.deepEqual(value, packet); return { seq: packet.seq }; } });
  const created = await uploads.create('token', manifest);
  await uploads.put('token', created.upload_id, 0, chunks[0]); await uploads.put('token', created.upload_id, 0, chunks[0]);
  await assert.rejects(uploads.put('token', created.upload_id, 0, Buffer.from('different')), error => error.status === 409);
  await uploads.put('token', created.upload_id, 1, chunks[1]);
  assert.deepEqual(await uploads.commit('token', created.upload_id), { seq: packet.seq });
  assert.deepEqual(await uploads.commit('token', created.upload_id), { seq: packet.seq }); assert.equal(applied, 1);
});
test('upload caps open manifests and expires them after seven days', async () => {
  const m = memory(), { manifest } = input();
  const uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async () => ({}) });
  const first = await uploads.create('token', manifest); await uploads.create('token', { ...manifest, seq: manifest.seq + 1 });
  await assert.rejects(uploads.create('token', { ...manifest, seq: manifest.seq + 2 }), error => error.status === 429);
  m.advance(604800000);
  await assert.rejects(uploads.commit('token', first.upload_id), error => error.status === 410);
  assert.ok((await uploads.create('token', manifest)).upload_id);
});
test('a repeated create for the same envelope returns the open upload so a lost response cannot orphan uploads', async () => {
  const m = memory(), { manifest } = input();
  const uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async () => ({}) });
  const first = await uploads.create('token', manifest);
  assert.deepEqual(await uploads.create('token', manifest), first);
  assert.deepEqual(await uploads.create('token', manifest), first);
  // The same cap still holds for other envelopes, and a changed manifest never reuses the upload.
  const other = await uploads.create('token', { ...manifest, sha256: 'f'.repeat(64) });
  assert.notEqual(other.upload_id, first.upload_id);
  await assert.rejects(uploads.create('token', { ...manifest, seq: manifest.seq + 1 }), error => error.status === 429);
});
test('partial, mismatched and invalid UTF-8 uploads never apply', async () => {
  const m = memory(), { chunks, manifest } = input(); let applied = 0;
  const uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async () => { applied++; return {}; } });
  const partial = await uploads.create('token', manifest); await uploads.put('token', partial.upload_id, 0, chunks[0]);
  await assert.rejects(uploads.commit('token', partial.upload_id), error => error.code === 'incomplete_upload');
  const wrong = await uploads.create('token', { ...manifest, sha256: 'f'.repeat(64) });
  await uploads.put('token', wrong.upload_id, 0, chunks[0]); await uploads.put('token', wrong.upload_id, 1, chunks[1]);
  await assert.rejects(uploads.commit('token', wrong.upload_id), error => error.code === 'upload_hash_mismatch');
  const other = memory(), invalid = Buffer.from([255]);
  const second = createUploadService({ db: other.db, createTx: other.tx, now: other.now, uuid: other.uuid, apply: async () => { applied++; } });
  const created = await second.create('token', { ...manifest, byte_length: 1, chunk_count: 1, sha256: sha(invalid) });
  await second.put('token', created.upload_id, 0, invalid);
  await assert.rejects(second.commit('token', created.upload_id), error => error.code === 'invalid_envelope');
  assert.equal(applied, 0);
});
test('invalid manifest and oversize chunks are rejected before binding or writes', async () => {
  const m = memory(), { manifest } = input();
  const uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async () => ({}) });
  await assert.rejects(uploads.create('token', { ...manifest, byte_length: 16777217 }), error => error.status === 400);
  const created = await uploads.create('token', manifest);
  await assert.rejects(uploads.put('token', created.upload_id, 0, Buffer.alloc(1048577)), error => error.status === 413);
});
test('multi-megabyte logical envelopes remain intact across bounded chunks', async () => {
  const m = memory(), packet = structuredClone(example); packet.payload.metadata.value.title = 'Ж'.repeat(2300000);
  const bytes = Buffer.from(JSON.stringify(packet)); assert.ok(bytes.length > 4500000);
  const manifest = { schema_version: 1, instance_id: packet.instance_id, device_id: packet.device_id, source_id: packet.source_id, reset_generation: 0, seq: packet.seq, kind: packet.kind, byte_length: bytes.length, sha256: sha(bytes), chunk_count: Math.ceil(bytes.length / 1048576) };
  let observed = 0;
  const uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async (tx, token, value) => { observed = value.payload.metadata.value.title.length; return { seq: value.seq }; } });
  const created = await uploads.create('token', manifest);
  for (let index = 0; index < manifest.chunk_count; index++) await uploads.put('token', created.upload_id, index, bytes.subarray(index * 1048576, (index + 1) * 1048576));
  await uploads.commit('token', created.upload_id); assert.equal(observed, 2300000);
});
test('upload enforces identities, chunk boundaries, duplicate chunks after commit and authentication', async () => {
  const m = memory(), { chunks, manifest } = input(), uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async () => ({ seq: manifest.seq }) });
  await assert.rejects(uploads.create('', manifest), error => error.status === 401);
  await assert.rejects(uploads.create('token', { ...manifest, reset_generation: 1 }), error => error.code === 'future_generation');
  const created = await uploads.create('token', manifest);
  await assert.rejects(uploads.put('token', created.upload_id, -1, chunks[0]), error => error.status === 400);
  await assert.rejects(uploads.put('token', created.upload_id, 2, chunks[0]), error => error.status === 400);
  await assert.rejects(uploads.put('token', 'missing', 0, chunks[0]), error => error.status === 404);
  await uploads.put('token', created.upload_id, 0, chunks[0]); await uploads.put('token', created.upload_id, 1, chunks[1]); await uploads.commit('token', created.upload_id);
  await uploads.put('token', created.upload_id, 0, chunks[0]);
  await assert.rejects(uploads.put('token', created.upload_id, 0, Buffer.from('different')), error => error.status === 409);
});
test('upload rejects changed manifest identity even when raw bytes hash correctly', async () => {
  const m = memory(), { chunks, manifest } = input(), uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async () => ({}) });
  const created = await uploads.create('token', { ...manifest, seq: manifest.seq + 1 });
  for (let i = 0; i < chunks.length; i++) await uploads.put('token', created.upload_id, i, chunks[i]);
  await assert.rejects(uploads.commit('token', created.upload_id), error => error.code === 'upload_identity_mismatch');
});
test('malformed assembled envelope returns 400 before applying or binding new source data', async () => {
  const m = memory(), { manifest } = input(), bad = Buffer.from('{}'); let applied = false;
  const uploads = createUploadService({ db: m.db, createTx: m.tx, now: m.now, uuid: m.uuid, apply: async () => { applied = true; } });
  const created = await uploads.create('token', { ...manifest, byte_length: bad.length, chunk_count: 1, sha256: sha(bad) });
  await uploads.put('token', created.upload_id, 0, bad);
  await assert.rejects(uploads.commit('token', created.upload_id), error => error.status === 400);
  assert.equal(applied, false);
});

test('uploaded event allocation is checked by the same ingestion path before event writes', async () => {
  const m = memory(), fixture = JSON.parse(readFileSync(new URL('../../contracts/examples/synthetic.json', import.meta.url)));
  const packet = structuredClone(fixture.envelopes[3]);
  packet.payload.events[0].allocation = [{ date: '2024-02-28', seconds: 5 }, { date: '2024-02-29', seconds: 5 }];
  const bytes = Buffer.from(JSON.stringify(packet));
  const manifest = { schema_version: 1, instance_id: packet.instance_id, device_id: packet.device_id, source_id: packet.source_id, reset_generation: 0, seq: packet.seq, kind: packet.kind, byte_length: bytes.length, sha256: sha(bytes), chunk_count: 1 };
  let writes = 0;
  const tx = draft => ({ ...m.tx(draft), lock: async () => ({ instance_id: packet.instance_id, reset_generation: 0, reporting_timezone: 'UTC' }), packet: async () => null, source: async () => fixture.envelopes[0].payload.metadata.value, saveEvent: async () => { writes++; } });
  const { createSyncService } = await import('../../server/sync.js');
  const sync = createSyncService({ db: m.db, createTx: tx });
  const upload = createUploadService({ db: m.db, createTx: tx, apply: sync.apply, now: m.now, uuid: m.uuid });
  const created = await upload.create('token', manifest); await upload.put('token', created.upload_id, 0, bytes);
  await assert.rejects(upload.commit('token', created.upload_id), error => error.code === 'invalid_allocation');
  assert.equal(writes, 0);
});
