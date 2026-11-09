import test from 'node:test';
import assert from 'node:assert/strict';
import { vocabulary } from '../../projects/server/library/vocabulary.js';
import { validate } from '../../contracts/validate.js';
function database() {
  let version = 1;
  const words = ['a', 'b', 'c'].map((x, i) => ({ word_key: String(i + 1).repeat(64), content: { word: x.repeat(50), language: null, source: null } }));
  return { words, change() { version++; }, async withTransaction(work) { return work({ query: async (sql, args) => {
    if ((sql.startsWith('SELECT instance_id') || sql.startsWith('SET TRANSACTION'))) return { rows: [{ reset_generation: 2 }] };
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
  const db = database(); db.words.splice(2); db.words[0].content.word = 'x'; db.words[1].content.word = 'y';
  const result = await vocabulary(db, { byte_budget: '200' });
  assert.equal(result.items.length, 2); assert.equal(result.next_cursor, null);
});

test('vocabulary counts each case-insensitive word and language once regardless of source', async () => {
  const db = database(); db.words.splice(0, db.words.length,
    ...[
      { word: 'Apple', language: 'en', source: 'one' },
      { word: 'apple', language: 'EN', source: 'two' },
      { word: 'apple', language: 'fr', source: null },
      { word: 'apple', language: null, source: null },
    ].map((content, i) => ({ word_key: String(i + 1).repeat(64), content })));
  const first = await vocabulary(db, { limit: '1' });
  assert.equal(first.count, 3); assert.deepEqual(first.items, [db.words[0].content]);
  const rest = await vocabulary(db, { limit: '10', cursor: first.next_cursor });
  assert.deepEqual(rest.items, db.words.slice(2).map(row => row.content));
});

test('vocabulary scans multiple batches without repeating a normalized word across pages', async () => {
  const db = database(); db.words.splice(0, db.words.length,
    ...Array.from({ length: 257 }, (_, i) => ({ word_key: i.toString(16).padStart(64, '0'), content: { word: `word-${i}`, language: null, source: null } })),
    { word_key: 'f'.repeat(64), content: { word: 'WORD-0', language: null, source: 'different' } });
  const first = await vocabulary(db, { limit: '100' });
  assert.equal(first.count, 257); assert.equal(first.items.length, 100);
  const second = await vocabulary(db, { cursor: first.next_cursor, limit: '100' });
  const third = await vocabulary(db, { cursor: second.next_cursor, limit: '100' });
  assert.equal(third.items.length, 57); assert.equal(third.next_cursor, null);
});

test('count-only vocabulary reports oversized items without returning them', async () => {
  const db = database(); db.words.splice(1); db.words[0].content.word = 'x'.repeat(300000);
  const result = await vocabulary(db, {}, true);
  assert.equal(result.count, 1);
});
