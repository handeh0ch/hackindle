import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentService } from '../../server/content.js';
const id = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
const source = 'a'.repeat(64);
function contentStore() {
  let version = 1; const text = '<script>"\\\nЁ😀</script>'.repeat(30000);
  const annotation = { annotation_id: id, source_id: source, version, archived: false, content: { kind: 'highlight', quote: text, note: 'Synthetic note', context: { status: 'pending', reason: 'Synthetic failure' } } };
  return { text, db: { query: async () => ({ rows: [{ ...annotation, version }] }) }, change: () => { version++; } };
}
test('long content is reconstructed safely within JSON byte limits and rejects stale cursors', async () => {
  const store = contentStore(), service = createContentService(store.db); let cursor, result = '', saved;
  do {
    const chunk = await service.content(id, { field: 'quote', ...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify(chunk)) <= 262144);
    result += chunk.text; cursor = chunk.next_cursor; saved ??= cursor;
  } while (cursor);
  assert.equal(result, store.text);
  store.change(); await assert.rejects(service.content(id, { field: 'quote', cursor: saved }), error => error.code === 'content_changed');
});
test('detail contains context metadata without full private content', async () => {
  const service = createContentService(contentStore().db), detail = await service.detail(id);
  assert.equal(detail.context_status, 'pending'); assert.equal(detail.context_reason, 'Synthetic failure');
  assert.equal(Object.hasOwn(detail, 'quote'), false);
  await assert.rejects(service.content(id, { field: 'unknown' }), error => error.status === 400);
});
test('content validates cursors, fields, identity and requested version', async () => {
  const store = contentStore(), service = createContentService(store.db);
  await assert.rejects(service.content(id, { field: 'quote', cursor: '!!!' }), error => error.code === 'invalid_cursor');
  await assert.rejects(service.content(id, { field: 'quote', version: 2 }), error => error.code === 'content_changed');
  const first = await service.content(id, { field: 'quote' });
  await assert.rejects(service.content(id, { field: 'note', cursor: first.next_cursor }), error => error.code === 'invalid_cursor');
  await assert.rejects(service.detail('invalid'), error => error.status === 400);
  await assert.rejects(createContentService({ query: async () => ({ rows: [] }) }).detail(id), error => error.status === 404);
  assert.equal((await service.content(id, { field: 'note' })).text, 'Synthetic note');
  assert.deepEqual(JSON.parse((await service.content(id, { field: 'context' })).text), { status: 'pending', reason: 'Synthetic failure' });
});

test('detail bounds multibyte reason while content retains it in full', async () => {
  const reason = '😀'.repeat(20000), row = { annotation_id: id, source_id: source, version: 1, archived: false, content: { kind: 'highlight', quote: '', note: '', context: { status: 'pending', reason } } };
  const service = createContentService({ query: async () => ({ rows: [row] }) });
  const detail = await service.detail(id);
  assert.equal(Array.from(detail.context_reason).length, 500);
  assert.ok(Buffer.byteLength(JSON.stringify(detail)) < 4096);
  assert.equal(JSON.parse((await service.content(id, { field: 'context' })).text).reason, reason);
});

test('detail truncates long captured timestamp while paged context preserves exact input', async () => {
  const captured = '2024-02-29 23:59:60.' + '1234567890'.repeat(30000) + 'Z';
  const context = { status: 'ready', origin: 'creation', captured_at: captured, page_basis: 'rendered', total_pages: 1, before: null, selection_pages: [{ number: 1, text: 'synthetic' }], after: null };
  const row = { annotation_id: id, source_id: source, version: 1, archived: false, content: { kind: 'highlight', quote: '', note: '', context } };
  const { validate } = await import('../../contracts/validate.js');
  const { readFileSync } = await import('node:fs');
  const fixture = JSON.parse(readFileSync(new URL('../../contracts/examples/synthetic.json', import.meta.url))).envelopes[0].payload.annotations.value[0];
  assert.equal(validate('annotation', { ...fixture, context }), false);
  const service = createContentService({ query: async () => ({ rows: [row] }) });
  const detail = await service.detail(id);
  assert.equal(detail.context_captured_at, '2024-02-29T23:59:60.123Z');
  assert.ok(Buffer.byteLength(JSON.stringify(detail)) < 4096);
  let cursor, result = '';
  do { const part = await service.content(id, { field: 'context', ...(cursor ? { cursor } : {}) }); result += part.text; cursor = part.next_cursor; } while (cursor);
  assert.deepEqual(JSON.parse(result), context);
  for (const suffix of ['Z', '.1Z', '.12Z', '.123Z']) {
    context.captured_at = '2024-02-29 23:59:60' + suffix;
    assert.equal((await service.detail(id)).context_captured_at, '2024-02-29T23:59:60' + suffix);
  }
});
