import test from 'node:test';
import assert from 'node:assert/strict';
import { progressHistory } from '../../server/progress-history.js';
import { validate } from '../../contracts/validate.js';
const source = 'a'.repeat(64), session = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
const samples = [1, 2, 3].map(i => ({ event_id: `00000000-0000-0000-0000-00000000000${i}`, progress: { fraction: i / 10, position: { type: 'xpointer', value: `/synthetic/${i}` }, observed_at: `2024-01-01T00:00:0${i}Z`, session_id: session }, sort_time: `2024-01-01T00:00:0${i}000000000` }));
function database() { return { withTransaction: async work => work({ query: async (sql, args = []) => {
  if ((sql.startsWith('SELECT instance_id') || sql.startsWith('SET TRANSACTION'))) return { rows: [{}] };
  if (sql.startsWith('SELECT source_id')) return { rows: args[0] === source ? [{ source_id: source }] : [] };
  if (sql.startsWith('SELECT e.event_id')) return { rows: samples.filter(row => !args[1] || row.sort_time > args[1] || (row.sort_time === args[1] && row.event_id > args[2])).slice(0, args[3]) };
  throw new Error(`Unexpected query: ${sql}`);
} }) }; }
test('progress history paginates source observations with a query-bound cursor', async () => {
  const db = database(), first = await progressHistory(db, source, { limit: '1' });
  assert.equal(validate('progress_history', first), true); assert.deepEqual(first.items, [samples[0].progress]); assert.ok(first.next_cursor);
  const next = await progressHistory(db, source, { cursor: first.next_cursor });
  assert.deepEqual(next.items, samples.slice(1).map(row => row.progress)); assert.equal(next.next_cursor, null);
  await assert.rejects(progressHistory(db, 'b'.repeat(64), { cursor: first.next_cursor }), e => e.code === 'invalid_cursor');
  await assert.rejects(progressHistory(db, source, { byte_budget: '1' }), e => e.status === 413);
  await assert.rejects(progressHistory(db, source, { limit: '0' }), e => e.status === 400);
});

test('progress history stops before an oversized later item and rejects it on the next page', async () => {
  const db = { withTransaction: async work => work({ query: async (sql, args = []) => {
    if ((sql.startsWith('SELECT instance_id') || sql.startsWith('SET TRANSACTION'))) return { rows: [{}] };
    if (sql.startsWith('SELECT source_id')) return { rows: [{ source_id: source }] };
    if (sql.startsWith('SELECT e.event_id')) {
      const large = { ...samples[1], progress: null, too_large: true };
      return { rows: args[1] ? [large] : [{ ...samples[0], too_large: false }, large] };
    }
    throw new Error('Unexpected query');
  } }) };
  const first = await progressHistory(db, source, {}); assert.deepEqual(first.items, [samples[0].progress]);
  await assert.rejects(progressHistory(db, source, { cursor: first.next_cursor }), e => e.status === 413);
});
