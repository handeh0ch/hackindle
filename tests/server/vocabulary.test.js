import test from 'node:test';
import assert from 'node:assert/strict';
import { vocabulary } from '../../server/vocabulary.js';
import { validate } from '../../contracts/validate.js';
function database() {
  let version = 1;
  const words = ['a', 'b', 'c'].map((x, i) => ({ word_key: String(i + 1).repeat(64), content: { word: x.repeat(50), language: null, source: null } }));
  return { words, change() { version++; }, async withTransaction(work) { return work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ reset_generation: 2 }] };
    if (sql.startsWith('SELECT v.device_id')) return { rows: [{ device_id: '48bc0344-efad-4c68-adb6-dc0f0ba57276', version }] };
    if (sql.startsWith('SELECT count')) return { rows: [{ count: String(words.length) }] };
    if (sql.startsWith('SELECT word_key')) return { rows: words.filter(w => w.word_key > args[0]).slice(0, args[1]) };
    throw new Error('Unexpected query');
  } }); } };
}
test('vocabulary pagination binds snapshot, respects limits and preserves each whole item', async () => {
  const db = database(), first = await vocabulary(db, { limit: '1' });
  assert.equal(validate('vocabulary', first), true); assert.equal(first.count, 3); assert.deepEqual(first.items, [db.words[0].content]); assert.ok(first.next_cursor);
  const second = await vocabulary(db, { cursor: first.next_cursor, limit: '2' });
  assert.deepEqual(second.items, db.words.slice(1).map(w => w.content)); assert.equal(second.next_cursor, null);
  const bounded = await vocabulary(db, { byte_budget: '320' });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 320); assert.ok(bounded.next_cursor); assert.deepEqual(bounded.items, [db.words[0].content]);
  await assert.rejects(vocabulary(db, { byte_budget: '1' }), e => e.status === 413);
  db.change(); await assert.rejects(vocabulary(db, { cursor: first.next_cursor }), e => e.code === 'invalid_cursor');
});
test('vocabulary rejects malformed or unrelated query options and forged cursors', async () => {
  const db = database();
  for (const query of [{ limit: '0' }, { limit: '101' }, { limit: 'a' }, { byte_budget: '262145' }, { search: 'x' }, { cursor: '!!!' }, { cursor: Buffer.from('{}').toString('base64url') }]) {
    await assert.rejects(vocabulary(db, query), e => e.status === 400);
  }
});


test('a complete small result fits even when an intermediate continuation cursor would not', async () => {
  const db = database(); db.words.splice(2); for (const row of db.words) row.content.word = 'x';
  const result = await vocabulary(db, { byte_budget: '200' });
  assert.equal(result.items.length, 2); assert.equal(result.next_cursor, null);
});
