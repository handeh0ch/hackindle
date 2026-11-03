import test from 'node:test';
import assert from 'node:assert/strict';
import { listMatches, decideMatch } from '../../server/matches.js';
import { validate } from '../../contracts/validate.js';
const first = '48bc0344-efad-4c68-adb6-dc0f0ba57276', second = 'a92e58b4-851b-467b-a5ad-1eaaccc84c61', a = 'a'.repeat(64), b = 'b'.repeat(64);
function database() {
  let state = { books: { [first]: 'Same', [second]: 'Same' }, memberships: { [a]: first, [b]: second }, decisions: {}, events: ['synthetic'] };
  return { state: () => state, withTransaction: async work => {
    const draft = structuredClone(state);
    const result = await work({ query: async (sql, args = []) => {
      if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: first, reset_generation: 0 }] };
      if (sql.startsWith('SELECT s.source_id, target.book_id')) return { rows: draft.decisions[`${a}:${second}`] ? [] : [{ source_id: a, candidate_book_id: second, reason: 'same_title' }] };
      if (sql.startsWith('SELECT book_id FROM book_sources')) return { rows: draft.memberships[args[0]] ? [{ book_id: draft.memberships[args[0]] }] : [] };
      if (sql.startsWith('SELECT book_id FROM books')) return { rows: draft.books[args[0]] ? [{ book_id: args[0] }] : [] };
      if (sql.startsWith('SELECT source_id, book_id FROM book_sources')) return { rows: args[0].filter(id => draft.memberships[id]).map(id => ({ source_id: id, book_id: draft.memberships[id] })) };
      if (sql.startsWith('UPDATE book_sources')) { for (const id of args[0]) draft.memberships[id] = args[1]; return { rows: [] }; }
      if (sql.startsWith('DELETE FROM books')) { for (const id of args[0]) if (!Object.values(draft.memberships).includes(id)) delete draft.books[id]; return { rows: [] }; }
      if (sql.startsWith('INSERT INTO match_decisions')) { draft.decisions[`${args[0]}:${args[1]}`] = args[2]; return { rows: [] }; }
      if (sql.startsWith('SELECT b.book_id')) return { rows: [{ book_id: args[0], title: draft.books[args[0]], minimum_bytes: 70 }] };
      if (sql.startsWith('SELECT s.source_id')) return { rows: Object.entries(draft.memberships).filter(([, id]) => id === args[0]).map(([source_id]) => ({ source_id, format: 'epub', title: 'Same', authors: [], progress: null, last_opened_at: null, cover_available: false })) };
      if (sql.startsWith('SELECT COALESCE')) return { rows: [{ active_annotations: '0', archived_annotations: '0', first_tracked_at: null, last_tracked_at: null, active_days: '0' }] };
      throw new Error('Unexpected query');
    } });
    state = draft; return result;
  } };
}
test('a rejected candidate remains separate and is suppressed in later lists', async () => {
  const db = database(), list = await listMatches(db, {}); assert.equal(validate('matches', list), true); assert.equal(list.items.length, 1);
  const result = await decideMatch(db, { source_id: a, book_id: second, decision: 'reject' });
  assert.equal(result.book_id, first); assert.equal(db.state().memberships[a], first); assert.equal(db.state().decisions[`${a}:${second}`], 'reject');
  assert.equal((await listMatches(db, {})).items.length, 0);
});
test('confirming a candidate moves its source without changing immutable history', async () => {
  const db = database(), result = await decideMatch(db, { source_id: a, book_id: second, decision: 'confirm' });
  assert.equal(result.book_id, second); assert.equal(db.state().memberships[a], second); assert.equal(db.state().decisions[`${a}:${second}`], 'confirm');
  assert.deepEqual(db.state().events, ['synthetic']); assert.equal(db.state().books[first], undefined);
  await assert.rejects(decideMatch(db, { source_id: a, book_id: second, decision: 'reject' }), e => e.code === 'already_grouped');
});
test('match query rejects invalid cursors, filters and tiny response budgets', async () => {
  const db = database();
  for (const query of [{ cursor: '!' }, { limit: '0' }, { search: 'x' }]) await assert.rejects(listMatches(db, query), e => e.status === 400);
  await assert.rejects(listMatches(db, { byte_budget: '1' }), e => e.status === 413);
  await assert.rejects(decideMatch(db, {}), e => e.status === 400);
});
