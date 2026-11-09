import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../projects/frontend/js/core/api.js';
import { isUuid, isSourceId } from '../../projects/frontend/js/lib/ids.js';
import { buildCatalog, sourceName } from '../../projects/frontend/js/models/catalog.js';
import { setFlash, takeFlash, flashHtml, guarded, errorText, needConfig } from '../../projects/frontend/js/core/flow.js';
import { BOOK_1, BOOK_2, SRC_A, SRC_B, SRC_C, book, book2, source } from './fixtures.js';

test('identifiers from the address are validated before they reach an API path', () => {
  assert.ok(isUuid(BOOK_1));
  assert.ok(isUuid(BOOK_1.toUpperCase()));
  for (const bad of ['', 'x', `${BOOK_1}/../x`, `${BOOK_1}?a=1`, '11111111-1111-4111-8111-11111111111g', null, undefined, 5]) assert.ok(!isUuid(bad), String(bad));
  assert.ok(isSourceId(SRC_A));
  for (const bad of ['a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(63)}/`, null]) assert.ok(!isSourceId(bad), String(bad));
});

test('the catalog maps every source to its file name, format and book', () => {
  const catalog = buildCatalog([book(), book2()], true);
  assert.equal(catalog.complete, true);
  assert.deepEqual(catalog.books.map(item => item.id), [BOOK_1, BOOK_2]);
  assert.equal(catalog.sources.get(SRC_B).format, 'PDF');
  assert.equal(catalog.sources.get(SRC_C).bookId, BOOK_2);
  assert.equal(sourceName(catalog, SRC_B), 'Synthetic · PDF');
  assert.equal(sourceName(catalog, 'f'.repeat(64)), 'Unknown file');
  assert.equal(sourceName(null, SRC_A), 'Unknown file');
  const untitled = buildCatalog([book({ sources: [source(SRC_A, 'epub', { title: '' })], title: 'Fallback' })]);
  assert.equal(sourceName(untitled, SRC_A), 'Fallback · EPUB');
});

test('a flash message is shown once', () => {
  const ctx = {};
  assert.equal(takeFlash(ctx), null);
  setFlash(ctx, 'status', 'Saved.');
  assert.match(flashHtml(takeFlash(ctx)), /id="flash" tabindex="-1" role="status">Saved\./);
  assert.equal(takeFlash(ctx), null);
  setFlash(ctx, 'alert', '<b>Bad</b> (code)');
  const html = flashHtml(takeFlash(ctx));
  assert.match(html, /id="flash" tabindex="-1" role="alert"/);
  assert.ok(!html.includes('<b>'));
  assert.equal(flashHtml(null), '');
});

test('errors show the stable code and never response text', () => {
  assert.equal(errorText('Could not save', new ApiError(500, 'http_500')), 'Could not save (http_500).');
  assert.equal(errorText('Could not save', new Error('secret detail')), 'Could not save (unexpected).');
  assert.match(errorText('x', new ApiError(409, 'nothing_to_split'), { nothing_to_split: 'Choose some files, not all.' }), /Choose some files, not all\. \(nothing_to_split\)/);
});

test('guarded actions pass results through, send 401 back to sign-in and report other errors', async () => {
  const visited = [];
  const navigate = async hash => { visited.push(hash); };
  const ctx = { hash: '#/connection' };
  assert.deepEqual(await guarded(ctx, navigate, async () => 5), { ok: true, value: 5 });
  assert.deepEqual(await guarded(ctx, navigate, async () => { throw new ApiError(401, 'unauthorized'); }), { ok: false, handled: true });
  assert.deepEqual(visited, ['#/connection']);
  const failed = await guarded(ctx, navigate, async () => { throw new ApiError(409, 'nothing_to_split'); });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'nothing_to_split');
  assert.equal((await guarded(ctx, navigate, async () => { throw new TypeError('x'); })).error.code, 'unexpected');
});

test('the reporting config is fetched once when the controller did not load it', async () => {
  let fetched = 0;
  const ctx = { config: null, api: { get: async path => { fetched += 1; return { path, characters_per_page: 2000 }; } } };
  assert.equal((await needConfig(ctx)).characters_per_page, 2000);
  await needConfig(ctx);
  assert.equal(fetched, 1);
});

test('guarded runs one mutation at a time', async () => {
  const ctx = { hash: '#/x' };
  let release, runs = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const first = guarded(ctx, async () => {}, async () => { runs += 1; await gate; return 'a'; });
  assert.deepEqual(await guarded(ctx, async () => {}, async () => { runs += 1; return 'b'; }), { ok: false, handled: true });
  release();
  assert.deepEqual(await first, { ok: true, value: 'a' });
  assert.equal(runs, 1);
  assert.deepEqual(await guarded(ctx, async () => {}, async () => 'c'), { ok: true, value: 'c' });
  await guarded(ctx, async () => {}, async () => { throw new ApiError(500, 'http_500'); });
  assert.deepEqual(await guarded(ctx, async () => {}, async () => 'd'), { ok: true, value: 'd' });   // a failure releases the lock
});
