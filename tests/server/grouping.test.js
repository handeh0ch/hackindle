import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBooks, splitBook } from '../../projects/server/library/grouping.js';
import { validate } from '../../contracts/validate.js';
const first = '48bc0344-efad-4c68-adb6-dc0f0ba57276', second = 'a92e58b4-851b-467b-a5ad-1eaaccc84c61', a = 'a'.repeat(64), b = 'b'.repeat(64);
function database() {
  let state = { books: { [first]: 'First', [second]: 'Second' }, memberships: { [a]: first, [b]: second }, events: ['synthetic history'] };
  return { state: () => state, withTransaction: async work => {
    const draft = structuredClone(state);
    const result = await work({ query: async (sql, args = []) => {
      if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: first, reset_generation: 0, reporting_timezone: 'UTC' }] };
      if (sql.startsWith('SELECT book_id, title FROM books')) return { rows: draft.books[args[0]] ? [{ book_id: args[0], title: draft.books[args[0]] }] : [] };
      if (sql.startsWith('SELECT book_id FROM books')) return { rows: draft.books[args[0]] ? [{ book_id: args[0] }] : [] };
      if (sql.startsWith('SELECT source_id, book_id FROM book_sources')) return { rows: args[0].filter(id => draft.memberships[id]).map(id => ({ source_id: id, book_id: draft.memberships[id] })) };
      if (sql.startsWith('SELECT source_id FROM book_sources')) return { rows: Object.entries(draft.memberships).filter(([, id]) => id === args[0]).map(([source_id]) => ({ source_id })) };
      if (sql.startsWith('INSERT INTO books')) { draft.books[args[0]] = args[1]; return { rows: [] }; }
      if (sql.startsWith('UPDATE book_sources')) { for (const source of args[0]) draft.memberships[source] = args[1]; return { rows: [] }; }
      if (sql.startsWith('DELETE FROM books')) { for (const id of args[0]) if (!Object.values(draft.memberships).includes(id)) delete draft.books[id]; return { rows: [] }; }
      if (sql.startsWith('SELECT b.book_id')) return { rows: draft.books[args[0]] ? [{ book_id: args[0], title: draft.books[args[0]], minimum_bytes: 150 }] : [] };
      if (sql.startsWith('SELECT s.source_id')) return { rows: Object.entries(draft.memberships).filter(([, id]) => id === args[0]).map(([source_id]) => ({ source_id, format: 'epub', title: 'Synthetic', authors: [], progress: null, last_opened_at: null, cover_available: false })) };
      if (sql.startsWith('SELECT COALESCE')) return { rows: [{ active_annotations: '0', archived_annotations: '0', first_tracked_at: null, last_tracked_at: null, active_days: '0' }] };
      throw new Error('Unexpected query');
    } });
    state = draft; return result;
  } };
}
test('merge then split returns both current books while retaining source histories', async () => {
  const db = database(), merged = await mergeBooks(db, { target_book_id: first, source_ids: [b] });
  assert.equal(validate('book', merged), true); assert.equal(merged.sources.length, 2); assert.equal(db.state().books[second], undefined);
  const split = await splitBook(db, first, { source_ids: [b] });
  assert.equal(validate('books', split), true); assert.equal(split.items.length, 2); assert.equal(db.state().memberships[a], first); assert.notEqual(db.state().memberships[b], first);
  assert.deepEqual(db.state().events, ['synthetic history']);
  await assert.rejects(splitBook(db, first, { source_ids: [a] }), error => error.code === 'nothing_to_split');
});
