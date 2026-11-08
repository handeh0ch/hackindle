import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../public/js/api.js';
import { buildCatalog } from '../../public/js/catalog.js';
import { buildMatches, matchesHtml, splitFormHtml, mergeFormHtml, groupingActions } from '../../public/js/grouping.js';
import { takeFlash } from '../../public/js/flow.js';
import { BOOK_1, BOOK_2, SRC_A, SRC_B, SRC_C, book, book2, source, fakeApi } from './fixtures.js';

const catalog = buildCatalog([book(), book2()], true);
const match = { source_id: SRC_C, candidate_book_id: BOOK_1, reason: 'same_title' };

test('uncertain matches name the file, its current book and the candidate in plain words', () => {
  const [row] = buildMatches({ matches: [match], catalog });
  assert.equal(row.sourceName, 'Synthetic · MOBI');
  assert.equal(row.currentBook, 'Other Book');
  assert.equal(row.candidate, 'Synthetic Book');
  assert.equal(row.reason, 'same title');
  assert.equal(row.confirm, `${SRC_C}|${BOOK_1}|confirm`);
  assert.equal(row.reject, `${SRC_C}|${BOOK_1}|reject`);
  const [unknown] = buildMatches({ matches: [{ source_id: 'f'.repeat(64), candidate_book_id: 'f'.repeat(8) + BOOK_1.slice(8), reason: 'odd_reason' }], catalog: null });
  assert.deepEqual([unknown.sourceName, unknown.currentBook, unknown.candidate, unknown.reason], ['Unknown file', 'Unknown book', 'Unknown book', 'odd reason']);
});

test('the match list explains what each choice does and is empty when there is nothing to decide', () => {
  const html = matchesHtml(buildMatches({ matches: [match], catalog }));
  assert.match(html, /Synthetic · MOBI/);
  assert.match(html, /same title/);
  assert.match(html, /<button type="button" data-action="match" data-value="c{64}\|1{8}-1{4}-4111-8111-1{12}\|confirm">Confirm same book<\/button>/);
  assert.match(html, /data-action="match" data-value="c{64}\|[^"]+\|reject">Keep separate<\/button>/);
  assert.match(html, /Nothing is deleted/);
  assert.match(matchesHtml([]), /No uncertain matches/);
  const hostile = matchesHtml(buildMatches({ matches: [{ ...match, reason: '<b>x</b>' }], catalog: buildCatalog([book({ title: '<i>T</i>' }), book2()]) }));
  assert.ok(!hostile.includes('<b>x') && !hostile.includes('<i>T'));
});

test('split and merge forms ask for a plain-language confirmation and start disabled', () => {
  const split = splitFormHtml(book());
  assert.match(split, /<form data-form="group-split" data-gate="ack" class="group-box">/);
  assert.match(split, /<input type="hidden" name="book" value="1{8}-/);
  assert.match(split, /<input type="checkbox" name="src-0" value="a{64}"> EPUB/);
  assert.match(split, /<input type="checkbox" name="src-1" value="b{64}"> PDF/);
  assert.match(split, /Nothing is deleted/);
  assert.match(split, /<input type="checkbox" name="ack"/);
  assert.match(split, /<button type="submit" data-gated disabled>Split into a new book<\/button>/);
  assert.match(splitFormHtml(book({ sources: [source(SRC_A, 'epub')] })), /only one file, so there is nothing to split/i);
  const merge = mergeFormHtml(book(), catalog);
  assert.match(merge, /<form data-form="group-merge" data-gate="ack" class="group-box">/);
  assert.match(merge, /<select name="target" required><option value="">Choose a book<\/option><option value="2{8}-[^"]+">Other Book<\/option><\/select>/);
  assert.ok(!/<option value="1{8}-/.test(merge));                       // not into itself
  assert.match(merge, /<input type="checkbox" name="src-0" value="a{64}" checked>/);
  assert.match(merge, /<button type="submit" data-gated disabled>Merge<\/button>/);
  assert.match(mergeFormHtml(book(), buildCatalog([book()])), /no other books/i);
  assert.match(mergeFormHtml(book(), null), /no other books/i);
});

function setup(answers = {}) {
  const api = fakeApi(answers);
  const ctx = { api, hash: `#/books/${BOOK_1}`, cache: { stale: true } };
  const visited = [];
  const helpers = { navigate: async (hash, options) => { visited.push([hash, options]); }, render() {} };
  return { api, ctx, helpers, visited };
}
const act = groupingActions.actions, forms = groupingActions.forms;

test('confirming a match sends the decision and opens the updated book', async () => {
  const { api, ctx, helpers, visited } = setup({ 'POST /owner/matches': book() });
  await act.match(ctx, `${SRC_C}|${BOOK_1}|confirm`, helpers);
  assert.deepEqual(api.calls[0], { method: 'POST', path: '/owner/matches', query: undefined, body: { source_id: SRC_C, book_id: BOOK_1, decision: 'confirm' } });
  assert.deepEqual(visited.map(([hash]) => hash), [`#/books/${BOOK_1}`]);
  assert.match(takeFlash(ctx).text, /grouped/i);
});

test('rejecting a match keeps the books apart and reloads the current page', async () => {
  const { api, ctx, helpers, visited } = setup({ 'POST /owner/matches': book2() });
  ctx.hash = '#/connection';
  await act.match(ctx, `${SRC_C}|${BOOK_1}|reject`, helpers);
  assert.equal(api.calls[0].body.decision, 'reject');
  assert.deepEqual(visited.map(([hash]) => hash), ['#/connection']);
  assert.match(takeFlash(ctx).text, /kept separate/i);
});

test('malformed match values and failed decisions never reach the wrong place', async () => {
  const { api, ctx, helpers } = setup({ 'POST /owner/matches': new ApiError(409, 'already_grouped') });
  for (const value of ['', 'x', `${SRC_C}|${BOOK_1}`, `${SRC_C}|${BOOK_1}|maybe`, `nope|${BOOK_1}|confirm`, `${SRC_C}|nope|confirm`, undefined]) await act.match(ctx, value, helpers);
  assert.equal(api.calls.length, 0);
  await act.match(ctx, `${SRC_C}|${BOOK_1}|confirm`, helpers);
  const flash = takeFlash(ctx);
  assert.equal(flash.kind, 'alert');
  assert.match(flash.text, /already in that book \(already_grouped\)/);
});

test('splitting sends the selected files and opens the new book', async () => {
  const { api, ctx, helpers, visited } = setup({ [`POST /owner/books/${BOOK_1}/split`]: { items: [book({ sources: [source(SRC_A, 'epub')] }), book({ book_id: BOOK_2, sources: [source(SRC_B, 'pdf')] })], next_cursor: null } });
  await forms['group-split'](ctx, { book: BOOK_1, 'src-1': SRC_B, ack: 'on' }, helpers);
  assert.deepEqual(api.calls[0].body, { source_ids: [SRC_B] });
  assert.deepEqual(visited.map(([hash]) => hash), [`#/books/${BOOK_2}`]);
  assert.match(takeFlash(ctx).text, /split/i);
});

test('splitting needs the confirmation and a selection, and explains a refused split', async () => {
  const { api, ctx, helpers, visited } = setup({ [`POST /owner/books/${BOOK_1}/split`]: new ApiError(409, 'nothing_to_split') });
  await forms['group-split'](ctx, { book: BOOK_1, 'src-0': SRC_A }, helpers);                 // no confirmation
  assert.equal(api.calls.length, 0);
  await forms['group-split'](ctx, { book: BOOK_1, ack: 'on' }, helpers);                      // nothing selected
  assert.equal(api.calls.length, 0);
  assert.match(takeFlash(ctx).text, /choose at least one file/i);
  await forms['group-split'](ctx, { book: 'bad', 'src-0': SRC_A, ack: 'on' }, helpers);
  await forms['group-split'](ctx, { book: BOOK_1, 'src-0': 'bad', ack: 'on' }, helpers);
  assert.equal(api.calls.length, 0);
  await forms['group-split'](ctx, { book: BOOK_1, 'src-0': SRC_A, 'src-1': SRC_B, ack: 'on' }, helpers);
  const flash = takeFlash(ctx);
  assert.match(flash.text, /choose some of this book's files, not all of them \(nothing_to_split\)/i);
  assert.equal(visited.at(-1)[0], `#/books/${BOOK_1}`);
});

test('merging sends the files and the target and opens the target book', async () => {
  const { api, ctx, helpers, visited } = setup({ 'POST /owner/books/merge': book2() });
  await forms['group-merge'](ctx, { book: BOOK_1, target: BOOK_2, 'src-0': SRC_A, 'src-1': SRC_B, ack: 'on' }, helpers);
  assert.deepEqual(api.calls[0].body, { source_ids: [SRC_A, SRC_B], target_book_id: BOOK_2 });
  assert.deepEqual(visited.map(([hash]) => hash), [`#/books/${BOOK_2}`]);
  assert.match(takeFlash(ctx).text, /merged/i);
});

test('merging refuses bad input, an unconfirmed form and sends 401 back to sign-in', async () => {
  const { api, ctx, helpers, visited } = setup({ 'POST /owner/books/merge': new ApiError(401, 'unauthorized') });
  await forms['group-merge'](ctx, { book: BOOK_1, target: BOOK_2, 'src-0': SRC_A }, helpers);
  await forms['group-merge'](ctx, { book: BOOK_1, target: BOOK_1, 'src-0': SRC_A, ack: 'on' }, helpers);
  await forms['group-merge'](ctx, { book: BOOK_1, target: 'bad', 'src-0': SRC_A, ack: 'on' }, helpers);
  await forms['group-merge'](ctx, { book: BOOK_1, target: BOOK_2, ack: 'on' }, helpers);
  assert.equal(api.calls.length, 0);
  assert.match(takeFlash(ctx).text, /choose at least one file/i);
  visited.length = 0;
  await forms['group-merge'](ctx, { book: BOOK_1, target: BOOK_2, 'src-0': SRC_A, ack: 'on' }, helpers);
  assert.equal(takeFlash(ctx), null);
  assert.deepEqual(visited.map(([hash]) => hash), [ctx.hash]);
});

test('a split answer that is not the expected shape still reloads the page instead of throwing', async () => {
  for (const odd of [null, {}, { items: [] }, { items: [{ book_id: 'nope' }] }]) {
    const { ctx, helpers, visited } = setup({ [`POST /owner/books/${BOOK_1}/split`]: odd });
    await forms['group-split'](ctx, { book: BOOK_1, 'src-0': SRC_A, ack: 'on' }, helpers);
    assert.deepEqual(visited.map(([hash]) => hash), [ctx.hash], JSON.stringify(odd));
    assert.match(takeFlash(ctx).text, /split/i);
  }
});

test('a double submit sends one request and the next one is allowed afterwards', async () => {
  const { api, ctx, helpers } = setup({ 'POST /owner/books/merge': book2() });
  const values = { book: BOOK_1, target: BOOK_2, 'src-0': SRC_A, ack: 'on' };
  await Promise.all([forms['group-merge'](ctx, values, helpers), forms['group-merge'](ctx, values, helpers)]);
  assert.equal(api.calls.length, 1);
  await forms['group-merge'](ctx, values, helpers);
  assert.equal(api.calls.length, 2);
});

test('after a mutation focus goes to the flash message', async () => {
  const { ctx, helpers, visited } = setup({ 'POST /owner/matches': book() });
  await act.match(ctx, `${SRC_C}|${BOOK_1}|confirm`, helpers);
  assert.equal(visited[0][1].focus, '#flash');
});
