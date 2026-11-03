import test from 'node:test';
import assert from 'node:assert/strict';
import { listBooks, readBook } from '../../server/books.js';
import { validate } from '../../contracts/validate.js';
const id = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
function client(options = {}) {
  const rows = options.sources ?? [
    { source_id: 'a'.repeat(64), format: 'epub', title: 'Synthetic', authors: ['First'], progress: null, last_opened_at: '2024-01-01T00:00:00.123456788Z', cover_available: false },
    { source_id: 'b'.repeat(64), format: 'pdf', title: 'Second', authors: ['Second'], progress: null, last_opened_at: '2024-01-01T00:00:00.123456789Z', cover_available: false },
  ];
  let sourceReads = 0;
  return { get sourceReads() { return sourceReads; }, async query(sql) {
    if (sql.startsWith('SELECT b.book_id')) return { rows: options.missing ? [] : [{ book_id: id, title: options.title ?? 'Synthetic', minimum_bytes: options.minimum ?? 150 }] };
    if (sql.startsWith('SELECT s.source_id')) { sourceReads++; return { rows }; }
    if (sql.startsWith('SELECT COALESCE')) return { rows: [{ active_annotations: '1', archived_annotations: '2', first_tracked_at: null, last_tracked_at: null, active_days: '0' }] };
    throw new Error('Unexpected query');
  } };
}
test('book detail uses exact nanosecond opening order and preserves per-source state', async () => {
  const result = await readBook(client(), id);
  assert.equal(validate('book', result), true); assert.equal(result.most_recent_source_id, 'b'.repeat(64)); assert.deepEqual(result.authors, ['Second']);
  assert.equal(result.active_annotations, 1); assert.equal(result.archived_annotations, 2);
});
test('book source selects the newest progress observation at nanosecond precision', async () => {
  const progress = time => ({ fraction: 0.5, position: { type: 'xpointer', value: '/synthetic' }, observed_at: time, session_id: id });
  const older = progress('2024-01-01T00:00:00.123456788Z'), newer = progress('2024-01-01T00:00:00.123456789Z');
  const source = { source_id: 'a'.repeat(64), format: 'epub', title: 'Synthetic', authors: [], progress: older, event_progress: newer, last_opened_at: null, cover_available: false };
  const result = await readBook(client({ sources: [source] }), id);
  assert.deepEqual(result.sources[0].progress, newer); assert.equal(validate('book', result), true);
  const tied = { ...newer, fraction: 0.9, observed_at: '2024-01-01 00:00:00.123456789Z' };
  assert.deepEqual((await readBook(client({ sources: [{ ...source, progress: tied }] }), id)).sources[0].progress, tied);
  assert.deepEqual((await readBook(client({ sources: [{ ...source, progress: null }] }), id)).sources[0].progress, newer);
});
test('book projection rejects missing, invalid and oversized items without truncation', async () => {
  await assert.rejects(readBook(client(), 'bad'), e => e.status === 400);
  await assert.rejects(readBook(client({ missing: true }), id), e => e.status === 404);
  const large = client({ minimum: 1000 }); await assert.rejects(readBook(large, id, 200), e => e.status === 413); assert.equal(large.sourceReads, 0);
  const multibyte = client({ title: '😀'.repeat(100), minimum: 150 }); await assert.rejects(readBook(multibyte, id, 400), e => e.status === 413);
});

test('book list cursors bind search and byte budgets preserve complete escaped Unicode items', async () => {
  const ids = [id, 'a92e58b4-851b-467b-a5ad-1eaaccc84c61'];
  const db = { withTransaction: async work => work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{}] };
    if (sql.startsWith('SELECT b.book_id FROM books')) return { rows: ids.filter(value => !args[1] || value > args[1]).slice(0, args[2]).map(book_id => ({ book_id })) };
    if (sql.startsWith('SELECT b.book_id')) return { rows: [{ book_id: args[0], title: '😀"\\', minimum_bytes: 70 }] };
    if (sql.startsWith('SELECT s.source_id')) return { rows: [{ source_id: 'a'.repeat(64), format: 'epub', title: '😀"\\', authors: [], progress: null, last_opened_at: null, cover_available: false }] };
    if (sql.startsWith('SELECT COALESCE')) return { rows: [{ active_annotations: '0', archived_annotations: '0', active_days: '0', first_tracked_at: null, last_tracked_at: null }] };
    throw new Error('Unexpected query');
  } }) };
  const first = await listBooks(db, { search: 'synthetic', limit: '1' });
  assert.equal(validate('books', first), true); assert.equal(first.items.length, 1); assert.ok(first.next_cursor);
  const next = await listBooks(db, { search: 'synthetic', cursor: first.next_cursor }); assert.equal(next.items[0].book_id, ids[1]); assert.equal(next.next_cursor, null);
  await assert.rejects(listBooks(db, { search: 'different', cursor: first.next_cursor }), e => e.code === 'invalid_cursor');
  await assert.rejects(listBooks(db, { byte_budget: '50' }), e => e.status === 413);
  await assert.rejects(listBooks(db, { search: ['invalid'] }), e => e.status === 400);
  await assert.rejects(listBooks(db, { cursor: '!' }), e => e.code === 'invalid_cursor');
});

test('book source list paginates and binds its cursor to a book', async () => {
  const { listSources } = await import('../../server/books.js');
  const sourceRows = ['a', 'b'].map(letter => ({ source_id: letter.repeat(64), format: 'epub', title: 'Synthetic', authors: [], progress: null, event_progress: null, last_opened_at: null, cover_available: false }));
  const db = { withTransaction: async work => work({ query: async (sql, args = []) => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{}] };
    if (sql.startsWith('SELECT book_id FROM books')) return { rows: [{ book_id: id }] };
    if (sql.startsWith('SELECT s.source_id')) return { rows: sourceRows.filter(row => row.source_id > (args[1] ?? '')).slice(0, args[2]) };
    throw new Error('Unexpected query');
  } }) };
  const first = await listSources(db, id, { limit: '1' });
  assert.equal(validate('sources', first), true); assert.equal(first.items.length, 1); assert.ok(first.next_cursor);
  const second = await listSources(db, id, { cursor: first.next_cursor }); assert.equal(second.items[0].source_id, 'b'.repeat(64));
  await assert.rejects(listSources(db, 'a92e58b4-851b-467b-a5ad-1eaaccc84c61', { cursor: first.next_cursor }), e => e.code === 'invalid_cursor');
  await assert.rejects(listSources(db, id, { byte_budget: '1' }), e => e.status === 413);
});

test('source list stops before an oversized later item and rejects it on the next page', async () => {
  const firstRow = { source_id: 'a'.repeat(64), format: 'epub', title: 'Synthetic', authors: [], progress: null, event_progress: null, last_opened_at: null, cover_available: false, too_large: false };
  const oversized = { source_id: 'b'.repeat(64), too_large: true };
  const db = { withTransaction: async work => work({ query: async (sql, args = []) => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{}] };
    if (sql.startsWith('SELECT book_id FROM books')) return { rows: [{ book_id: id }] };
    if (sql.startsWith('SELECT s.source_id')) return { rows: args[1] ? [oversized] : [firstRow, oversized] };
    throw new Error('Unexpected query');
  } }) };
  const first = await (await import('../../server/books.js')).listSources(db, id, {});
  assert.equal(first.items.length, 1); assert.equal(first.items[0].source_id, firstRow.source_id);
  await assert.rejects((await import('../../server/books.js')).listSources(db, id, { cursor: first.next_cursor }), e => e.status === 413);
});
