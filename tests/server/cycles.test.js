import test from 'node:test';
import assert from 'node:assert/strict';
import { listCycles } from '../../server/cycles.js';
import { validate } from '../../contracts/validate.js';
const source = 'a'.repeat(64), book = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
const cycles = [1, 2].map(i => ({ cycle_id: `00000000-0000-0000-0000-00000000000${i}`, source_id: source, started_at: '2024-01-01T00:00:00Z', finished_at: i === 1 ? '2024-02-01T00:00:00Z' : null }));
const db = { withTransaction: async work => work({ query: async (sql, args = []) => {
  if (sql.startsWith('SELECT instance_id')) return { rows: [{}] };
  if (sql.startsWith('SELECT e.content')) return { rows: cycles.filter(row => !args[2] || row.cycle_id > args[2] || (row.cycle_id === args[2] && row.source_id > args[3])).slice(0, args[4]) };
  throw new Error('Unexpected query');
} }) };
test('cycle list returns source-specific starts and finishes with filter-bound pagination', async () => {
  const first = await listCycles(db, { book_id: book, source_id: source, limit: '1' });
  assert.equal(validate('cycles', first), true); assert.deepEqual(first.items, [cycles[0]]);
  const second = await listCycles(db, { book_id: book, source_id: source, cursor: first.next_cursor });
  assert.deepEqual(second.items, [cycles[1]]); assert.equal(second.next_cursor, null);
  await assert.rejects(listCycles(db, { source_id: source, cursor: first.next_cursor }), e => e.code === 'invalid_cursor');
  await assert.rejects(listCycles(db, { byte_budget: '1' }), e => e.status === 413);
});
