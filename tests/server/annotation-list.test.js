import test from 'node:test';
import assert from 'node:assert/strict';
import { listAnnotations } from '../../server/annotation-list.js';
import { validate } from '../../contracts/validate.js';
const source = 'a'.repeat(64), book = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
const records = [1, 2].map(i => ({ annotation_id: `00000000-0000-0000-0000-00000000000${i}`, source_id: source, version: '1', kind: 'highlight', archived: false, quote_preview: 'synthetic', note_preview: '', context_status: 'pending' }));
const db = { withTransaction: async work => work({ query: async (sql, args = []) => {
  if (sql.startsWith('SELECT instance_id')) return { rows: [{}] };
  if (sql.startsWith('SELECT a.annotation_id')) return { rows: records.filter(row => !args[4] || row.annotation_id > args[4]).slice(0, args[5]) };
  throw new Error('Unexpected query');
} }) };
test('annotation list paginates previews and binds cursors to its filters', async () => {
  const first = await listAnnotations(db, { book_id: book, search: 'synth', limit: '1' });
  assert.equal(validate('annotations', first), true); assert.deepEqual(first.items, [{ ...records[0], version: 1 }]);
  const second = await listAnnotations(db, { book_id: book, search: 'synth', cursor: first.next_cursor });
  assert.deepEqual(second.items, [{ ...records[1], version: 1 }]);
  await assert.rejects(listAnnotations(db, { book_id: book, search: 'different', cursor: first.next_cursor }), e => e.code === 'invalid_cursor');
  await assert.rejects(listAnnotations(db, { archive: 'bad' }), e => e.status === 400);
  await assert.rejects(listAnnotations(db, { byte_budget: '1' }), e => e.status === 413);
});
test('annotation query passes each filter as a parameter', async () => {
  let parameters;
  const checked = { withTransaction: async work => work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT a.annotation_id')) { parameters = args; return { rows: [] }; }
    return { rows: [{}] };
  } }) };
  await listAnnotations(checked, { book_id: book, source_id: source, archive: 'archived', search: 'quoted' });
  assert.deepEqual(parameters, [book, source, 'quoted', 'archived', null, 51]);
});
