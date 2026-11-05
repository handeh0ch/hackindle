import test from 'node:test';
import assert from 'node:assert/strict';
import { listSessions } from '../../server/sessions.js';
import { validate } from '../../contracts/validate.js';
const source = 'a'.repeat(64), cycle = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
const rows = [1, 2].map(i => ({ session_id: `00000000-0000-0000-0000-00000000000${i}`, source_id: source, started_at: '2024-01-01T00:00:00Z', ended_at: i === 1 ? '2024-01-01T01:00:00Z' : null, cycle_id: cycle, characters: i === 1 ? '0' : null, active_seconds: i === 1 ? '60' : null, volume_measured: i === 1 ? '1' : '0', volume_unknown: i === 1 ? '0' : '1', time_measured: i === 1 ? '1' : '0', time_unknown: i === 1 ? '1' : '1' }));
const db = { withTransaction: async work => work({ query: async (sql, args = []) => {
  if ((sql.startsWith('SELECT instance_id') || sql.startsWith('SET TRANSACTION'))) return { rows: [{}] };
  if (sql.startsWith('SELECT e.content')) return { rows: rows.filter(row => !args[2] || row.session_id > args[2]).slice(0, args[4]) };
  throw new Error('Unexpected query');
} }) };
test('sessions expose measured reread time and distinguish partial or unavailable totals', async () => {
  const first = await listSessions(db, { source_id: source, limit: '1' });
  assert.equal(validate('sessions', first), true); assert.deepEqual(first.items[0], { session_id: rows[0].session_id, source_id: source, started_at: rows[0].started_at, ended_at: rows[0].ended_at, cycle_id: cycle, characters: 0, active_seconds: 60, volume_status: 'available', time_status: 'partial' });
  const next = await listSessions(db, { source_id: source, cursor: first.next_cursor });
  assert.equal(next.items[0].characters, null); assert.equal(next.items[0].volume_status, 'unavailable'); assert.equal(next.items[0].time_status, 'unavailable');
  await assert.rejects(listSessions(db, { cursor: first.next_cursor }), e => e.code === 'invalid_cursor');
});

test('session totals reject unsafe integer values', async () => {
  const unsafe = { withTransaction: async work => work({ query: async sql => (sql.startsWith('SELECT instance_id') || sql.startsWith('SET TRANSACTION')) ? { rows: [{}] } : { rows: [{ ...rows[0], characters: '9007199254740992' }] } }) };
  await assert.rejects(listSessions(unsafe, {}), e => e.code === 'totals_overflow');
});
