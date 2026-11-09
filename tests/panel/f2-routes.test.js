import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../projects/frontend/js/core/api.js';
import { addDays } from '../../projects/frontend/js/lib/format.js';
import { BOOK_1, BOOK_2, NOTE_1, NOTE_2, SRC_A, SRC_B, SRC_C, appHarness, book, book2, day, detail, note, page, readyContext, sample, session } from './fixtures.js';

const TODAY = '2026-11-08';
const dailyFor = query => { const days = []; for (let date = query.from; date <= query.to; date = addDays(date, 1)) days.push(day(date, date === '2026-11-06' ? null : 2000)); return { days, summary: {} }; };
const sessionId = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const sessionsFor = query => page([1, 2, 3].map(index => session(index, { source_id: query.source_id, session_id: sessionId(index) })));
const bookAnswers = (extra = {}) => ({
  [`GET /owner/books/${BOOK_1}`]: book(),
  'GET /owner/statistics/daily': dailyFor,
  [`GET /owner/sources/${SRC_B}/progress`]: page([sample(0.6, '2026-11-05T09:00:00Z'), sample(0.7, '2026-11-07T09:00:00Z')]),
  [`GET /owner/sources/${SRC_A}/progress`]: page([sample(0.1, '2026-11-05T09:00:00Z')]),
  'GET /owner/sessions': sessionsFor,
  'GET /owner/cycles': page([]),
  'GET /owner/books': page([book(), book2()]),
  'GET /owner/matches': page([]),
  ...extra,
});
const callsTo = (h, path) => h.calls.filter(call => call.path === path);

test('the book page loads the book, its period, the most recent source history, sessions and cycles', async () => {
  const h = appHarness(bookAnswers());
  await h.controller.start(`#/books/${BOOK_1}`);
  assert.match(h.rendered[0], /role="status"/);                                    // loading first
  assert.match(h.last(), /<h2>Synthetic Book<\/h2>/);
  assert.match(h.last(), /aria-pressed="true">PDF · 70%/);
  const daily = callsTo(h, '/owner/statistics/daily')[0].query;
  assert.deepEqual([daily.from, daily.to, daily.book_id], [addDays(TODAY, -29), TODAY, BOOK_1]);
  assert.equal(callsTo(h, `/owner/sources/${SRC_B}/progress`).length, 1);
  assert.deepEqual([callsTo(h, '/owner/sessions')[0].query.book_id, callsTo(h, '/owner/sessions')[0].query.source_id], [BOOK_1, SRC_B]);
  assert.equal(callsTo(h, '/owner/cycles')[0].query.source_id, SRC_B);
  assert.match(h.last(), /<li class="session"/);
  assert.match(h.last(), /progress 70%/);
});

test('switching the source loads that source only, without joining the two histories', async () => {
  const h = appHarness(bookAnswers());
  await h.controller.start(`#/books/${BOOK_1}`);
  assert.match(h.last(), /progress 70%/);
  await h.controller.action('book-source', SRC_A);
  const second = h.last();
  assert.match(second, /aria-pressed="true">EPUB · 40%/);
  assert.match(second, /progress 10%/);
  assert.ok(!/progress 70%|progress 60%/.test(second));                              // nothing from the other source
  assert.equal(callsTo(h, `/owner/books/${BOOK_1}`).length, 1);                      // the book is not reloaded
  assert.equal(callsTo(h, '/owner/sessions').at(-1).query.source_id, SRC_A);
  assert.equal(h.lastHint(), `[data-action="book-source"][data-value="${SRC_A}"]`);
  await h.controller.action('book-source', SRC_B);                                   // back: served from what was loaded
  assert.equal(callsTo(h, `/owner/sources/${SRC_B}/progress`).length, 1);
  await h.controller.action('book-source', 'not-a-source');                          // ignored
  assert.match(h.last(), /aria-pressed="true">PDF/);
});

test('the period choice stays within 366 days and only reloads the daily data', async () => {
  const h = appHarness(bookAnswers());
  await h.controller.start(`#/books/${BOOK_1}`);
  await h.controller.action('book-period', '365');
  const range = callsTo(h, '/owner/statistics/daily').at(-1).query;
  assert.equal(range.from, addDays(TODAY, -364));
  assert.match(h.last(), /aria-pressed="true">1 year/);
  assert.equal(h.lastHint(), '[data-action="book-period"][data-value="365"]');
  await h.controller.action('book-period', '9999');                                   // unsupported: ignored
  assert.match(h.last(), /aria-pressed="true">1 year/);
  await h.controller.action('book-period', '30');
  assert.equal(callsTo(h, '/owner/statistics/daily').length, 2);                      // 30 days again is already loaded
  assert.match(h.last(), /aria-pressed="true">30 days/);
});

test('the journal shows ten sessions and ten more on request', async () => {
  const many = query => page(Array.from({ length: 25 }, (_, index) => session(1, { source_id: query.source_id, started_at: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00Z`, session_id: sessionId(index + 1) })));
  const h = appHarness(bookAnswers({ 'GET /owner/sessions': many }));
  await h.controller.start(`#/books/${BOOK_1}`);
  const count = () => (h.last().match(/<li class="session"/g) ?? []).length;
  assert.equal(count(), 10);
  assert.match(h.last(), /25 sessions/);
  await h.controller.action('journal-more');
  assert.equal(count(), 20);
  assert.equal(h.lastHint(), '[data-action="journal-more"]');
  await h.controller.action('journal-more');
  assert.equal(count(), 25);
  assert.equal(h.lastHint(), '#journal-title');
  assert.ok(!/journal-more/.test(h.last()));
  await h.controller.action('book-source', SRC_A);                                    // a new source starts at ten again
  assert.equal(count(), 10);
});

test('progress follows its cursors', async () => {
  const progress = query => query.cursor ? page([sample(0.7, '2026-11-07T09:00:00Z')]) : page([sample(0.6, '2026-11-05T09:00:00Z')], 'next');
  const h = appHarness(bookAnswers({ [`GET /owner/sources/${SRC_B}/progress`]: progress }));
  await h.controller.start(`#/books/${BOOK_1}`);
  assert.equal(callsTo(h, `/owner/sources/${SRC_B}/progress`).length, 2);
  assert.match(h.last(), /progress 60%/);
  assert.match(h.last(), /progress 70%/);
});

test('invalid ids make no API call and a missing book has its own message', async () => {
  const h = appHarness(bookAnswers());
  await h.controller.navigate('#/books/..%2Fadmin');
  assert.match(h.last(), /not a valid book address/i);
  assert.equal(h.calls.filter(call => call.path.startsWith('/owner/books/')).length, 0);
  const missing = appHarness({ ...bookAnswers(), [`GET /owner/books/${BOOK_1}`]: new ApiError(404, 'book_not_found') });
  await missing.controller.start(`#/books/${BOOK_1}`);
  assert.match(missing.last(), /Book not found/);
  assert.match(missing.last(), /href="#\/books"/);
});

test('errors and sign-in on the book page use the shared states', async () => {
  const failing = appHarness(bookAnswers({ 'GET /owner/sessions': new ApiError(500, 'http_500') }));
  await failing.controller.start(`#/books/${BOOK_1}`);
  assert.match(failing.last(), /role="alert"[^>]*>.*http_500/s);
  const expired = appHarness(bookAnswers({ [`GET /owner/books/${BOOK_1}`]: new ApiError(401, 'unauthorized') }));
  await expired.controller.start(`#/books/${BOOK_1}`);
  assert.match(expired.last(), /data-form="login"/);
});

test('uncertain matches and the grouping forms appear on the book page', async () => {
  const h = appHarness(bookAnswers({ 'GET /owner/matches': page([{ source_id: SRC_C, candidate_book_id: BOOK_1, reason: 'same_title' }, { source_id: 'd'.repeat(64), candidate_book_id: BOOK_2, reason: 'same_title' }]) }));
  await h.controller.start(`#/books/${BOOK_1}`);
  assert.equal((h.last().match(/data-action="match"/g) ?? []).length, 2);              // one match: confirm and reject
  assert.match(h.last(), /<form data-form="group-split"/);
  assert.match(h.last(), /<form data-form="group-merge"/);
});

test('a grouping action reports its result on the page it reloads, once', async () => {
  const h = appHarness(bookAnswers({ [`POST /owner/books/${BOOK_1}/split`]: new ApiError(409, 'nothing_to_split') }));
  await h.controller.start(`#/books/${BOOK_1}`);
  await h.controller.submit('group-split', { book: BOOK_1, 'src-0': SRC_A, 'src-1': SRC_B, ack: 'on' });
  assert.match(h.last(), /role="alert"[^>]*>[^<]*nothing_to_split/);
  assert.match(h.last(), /<h2>Synthetic Book<\/h2>/);
  await h.controller.action('book-source', SRC_A);
  assert.ok(!/nothing_to_split/.test(h.last()));
});

const notesAnswers = (extra = {}) => ({
  'GET /owner/books': page([book(), book2()]),
  'GET /owner/annotations': query => query.cursor ? page([note(2)]) : page([note(1)], query.archive === 'active' && !query.search ? 'cur2' : null),
  ...extra,
});

test('the notes page lists active notes with counts and pages with a cursor', async () => {
  const h = appHarness(notesAnswers());
  await h.controller.start('#/notes');
  assert.match(h.last(), /<h2>Notes <span class="count">5 active<\/span><\/h2>/);
  assert.equal(callsTo(h, '/owner/annotations')[0].query.archive, 'active');
  assert.match(h.last(), new RegExp(`href="#/notes/${NOTE_1}"`));
  assert.match(h.last(), /data-action="notes-more"/);
  await h.controller.action('notes-more');
  assert.equal(callsTo(h, '/owner/annotations').at(-1).query.cursor, 'cur2');
  assert.match(h.last(), new RegExp(`href="#/notes/${NOTE_1}"[\\s\\S]*href="#/notes/${NOTE_2}"`));
  assert.ok(!/notes-more/.test(h.last()));
  assert.equal(callsTo(h, '/owner/annotations').length, 2);                           // the first page is not reloaded
  await h.controller.action('notes-more');                                            // nothing left: no request
  assert.equal(callsTo(h, '/owner/annotations').length, 2);
});

test('the archive switch and the filters query the server and keep correct counts', async () => {
  const h = appHarness(notesAnswers());
  await h.controller.start('#/notes');
  await h.controller.action('notes-archive', 'archived');
  assert.equal(callsTo(h, '/owner/annotations').at(-1).query.archive, 'archived');
  assert.match(h.last(), /aria-pressed="true">Archived \(1\)/);
  assert.match(h.last(), /Active \(5\)/);
  assert.equal(h.lastHint(), '[data-action="notes-archive"][data-value="archived"]');
  await h.controller.action('notes-archive', 'bogus');
  assert.match(h.last(), /aria-pressed="true">Archived/);
  await h.controller.submit('notes-filter', { q: ' дом ', book: BOOK_1, source: SRC_A });
  const query = callsTo(h, '/owner/annotations').at(-1).query;
  assert.deepEqual([query.search, query.book_id, query.source_id, query.archive], ['дом', BOOK_1, SRC_A, 'archived']);
  assert.match(h.last(), /value="дом"/);
  await h.controller.submit('notes-filter', { q: '', book: 'nope', source: 'nope' });
  const cleared = callsTo(h, '/owner/annotations').at(-1).query;
  assert.deepEqual([cleared.book_id, cleared.source_id, cleared.search], [undefined, undefined, undefined]);
});

test('the same quote in two formats stays two notes with their own detail and context', async () => {
  const same = { quote_preview: 'The same sentence', note_preview: '' };
  const answers = notesAnswers({
    'GET /owner/annotations': page([note(1, { ...same, source_id: SRC_A }), note(2, { ...same, source_id: SRC_B })]),
    [`GET /owner/annotations/${NOTE_1}`]: detail({ source_id: SRC_A }),
    [`GET /owner/annotations/${NOTE_2}`]: detail({ annotation_id: NOTE_2, source_id: SRC_B, context_origin: 'backfill' }),
    [`GET /owner/annotations/${NOTE_1}/content`]: query => ({ annotation_id: NOTE_1, version: 3, field: query.field, text: query.field === 'context' ? JSON.stringify(readyContext()) : 'The same sentence', next_cursor: null }),
    [`GET /owner/annotations/${NOTE_2}/content`]: query => ({ annotation_id: NOTE_2, version: 3, field: query.field,
      text: query.field === 'context' ? JSON.stringify(readyContext({ origin: 'backfill', before: null, selection_pages: [{ number: 1, text: 'PDF page one' }] })) : 'The same sentence', next_cursor: null }),
  });
  const h = appHarness(answers);
  await h.controller.start('#/notes');
  assert.equal((h.last().match(/<li class="note-item"/g) ?? []).length, 2);
  assert.match(h.last(), /Synthetic · EPUB[\s\S]*Synthetic · PDF/);
  await h.controller.navigate(`#/notes/${NOTE_1}`);
  assert.match(h.last(), /Before text/);
  assert.match(h.last(), /Captured when the note was made/);
  await h.controller.navigate(`#/notes/${NOTE_2}`);
  assert.match(h.last(), /PDF page one/);
  assert.match(h.last(), /Start of the document/);
  assert.match(h.last(), /Backfilled — page boundaries may differ/);
  assert.ok(!/Before text/.test(h.last()));
});

test('the note page restarts after a version change and reports invalid or missing notes', async () => {
  let version = 3;
  const answers = notesAnswers({
    [`GET /owner/annotations/${NOTE_1}`]: () => detail({ version, context_status: 'none', kind: 'bookmark' }),
    [`GET /owner/annotations/${NOTE_1}/content`]: query => {
      if (version === 3) { version = 4; throw new ApiError(409, 'content_changed'); }
      return { annotation_id: NOTE_1, version: query.version, field: query.field, text: `text v${query.version}`, next_cursor: null };
    },
  });
  const h = appHarness(answers);
  await h.controller.start(`#/notes/${NOTE_1}`);
  assert.match(h.last(), /text v4/);
  await h.controller.navigate('#/notes/x%20y');
  assert.match(h.last(), /not a valid note address/i);
  await h.controller.navigate(`#/notes/${NOTE_2}`);
  assert.match(h.last(), /Note not found/);
  const stuck = appHarness({ ...answers, [`GET /owner/annotations/${NOTE_1}/content`]: () => { throw new ApiError(409, 'content_changed'); } });
  await stuck.controller.start(`#/notes/${NOTE_1}`);
  assert.match(stuck.last(), /role="alert"[^>]*>.*content_changed/s);
});

test('the notes page reports a catalog that cannot be read', async () => {
  const h = appHarness(notesAnswers({ 'GET /owner/books': new ApiError(500, 'http_500') }));
  await h.controller.start('#/notes');
  assert.match(h.last(), /role="alert"[^>]*>.*http_500/s);
});

const connectionAnswers = (extra = {}) => ({
  'GET /owner/device': { device_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', last_sync_at: '2026-11-08T10:15:00Z', reset_generation: 2 },
  'GET /owner/goals/2026': { year: 2026, target: 12, completed_unique_books: 3 },
  'GET /owner/books': page([book(), book2()]),
  'GET /owner/matches': page([{ source_id: SRC_C, candidate_book_id: BOOK_1, reason: 'same_title' }]),
  ...extra,
});

test('the connection page shows the device, goal, grouping and reset', async () => {
  const h = appHarness(connectionAnswers());
  await h.controller.start('#/connection');
  assert.match(h.last(), /8 Nov 2026, 10:15 UTC/);
  assert.match(h.last(), /Books to finish in 2026/);
  assert.match(h.last(), /<h3 id="grouping-title">Grouping<\/h3>/);
  assert.match(h.last(), /data-action="match"/);
  assert.match(h.last(), /data-form="reset"/);
  const down = appHarness(connectionAnswers({ 'GET /owner/device': new ApiError(500, 'http_500') }));
  await down.controller.start('#/connection');
  assert.match(down.last(), /http_500/);
});

test('rotating the token needs the confirmation, shows the secret once and never keeps it', async () => {
  const SECRET = 'secret-token-value';
  const h = appHarness(connectionAnswers({ 'POST /owner/device/token': { device_token: SECRET } }));
  await h.controller.start('#/connection');
  await h.controller.submit('device-rotate', {});
  assert.equal(callsTo(h, '/owner/device/token').length, 0);
  await h.controller.submit('device-rotate', { ack: 'on' });
  assert.deepEqual(callsTo(h, '/owner/device/token')[0].body, {});
  assert.match(h.last(), /secret-token-value/);
  assert.equal(h.lastHint(), '#new-token');
  assert.ok(!JSON.stringify({ ...h.controller.ctx, api: null }).includes(SECRET));
  await h.controller.navigate('#/connection');
  assert.ok(!h.last().includes(SECRET));
  await h.controller.action('retry');
  assert.ok(!h.last().includes(SECRET));
});

test('a failed rotation shows the code and no secret', async () => {
  const h = appHarness(connectionAnswers({ 'POST /owner/device/token': new ApiError(409, 'no_device') }));
  await h.controller.start('#/connection');
  await h.controller.submit('device-rotate', { ack: 'on' });
  assert.match(h.last(), /role="alert"[^>]*>[^<]*no_device/);
});

test('unbinding is confirmed, reloads the device and says what happened', async () => {
  let unbound = false;
  const h = appHarness(connectionAnswers({
    'POST /owner/device/unbind': () => { unbound = true; return null; },
    'GET /owner/device': () => ({ device_id: unbound ? null : 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', last_sync_at: null, reset_generation: 2 }),
  }));
  await h.controller.start('#/connection');
  await h.controller.submit('device-unbind', {});
  assert.equal(callsTo(h, '/owner/device/unbind').length, 0);
  await h.controller.submit('device-unbind', { ack: 'on' });
  assert.deepEqual(callsTo(h, '/owner/device/unbind')[0].body, {});
  assert.match(h.last(), /Device unbound/);
  assert.match(h.last(), /No device linked/);
});

test('the yearly goal is validated and saved for the instance year', async () => {
  const h = appHarness(connectionAnswers({ 'PUT /owner/goals/2026': (query, body) => ({ year: 2026, target: body.target, completed_unique_books: 3 }) }));
  await h.controller.start('#/connection');
  for (const bad of ['', '-3', '2.5', 'many']) await h.controller.submit('goal-save', { target: bad });
  assert.equal(h.calls.filter(call => call.method === 'PUT').length, 0);
  assert.match(h.last(), /whole number/i);
  await h.controller.submit('goal-save', { target: '15' });
  const put = h.calls.find(call => call.method === 'PUT');
  assert.deepEqual([put.path, put.body], ['/owner/goals/2026', { target: 15 }]);
  assert.match(h.last(), /Goal for 2026 saved/);
});

test('reset needs the typed word, sends it and reports the new generation', async () => {
  const h = appHarness(connectionAnswers({ 'POST /owner/reset': { reset_generation: 3 } }));
  await h.controller.start('#/connection');
  await h.controller.submit('reset', { confirm: 'Reset' });
  await h.controller.submit('reset', {});
  assert.equal(callsTo(h, '/owner/reset').length, 0);
  await h.controller.submit('reset', { confirm: 'reset' });
  assert.deepEqual(callsTo(h, '/owner/reset')[0].body, { confirm: 'reset' });
  assert.match(h.last(), /Reset generation is now 3/);
  const failed = appHarness(connectionAnswers({ 'POST /owner/reset': new ApiError(500, 'http_500') }));
  await failed.controller.start('#/connection');
  await failed.controller.submit('reset', { confirm: 'reset' });
  assert.match(failed.last(), /role="alert"[^>]*>[^<]*http_500/);
  assert.ok(!/Reset generation is now/.test(failed.last()));
  let ended = false;
  const expired = appHarness(connectionAnswers({ 'POST /owner/reset': () => { ended = true; throw new ApiError(401, 'unauthorized'); },
    'GET /owner/device': () => { if (ended) throw new ApiError(401, 'unauthorized'); return { device_id: null, last_sync_at: null, reset_generation: 0 }; } }));
  await expired.controller.start('#/connection');
  await expired.controller.submit('reset', { confirm: 'reset' });
  assert.match(expired.last(), /data-form="login"/);
});

test('uncertain matches can be decided from the connection page', async () => {
  const h = appHarness(connectionAnswers({ 'POST /owner/matches': book() }));
  await h.controller.start('#/connection');
  await h.controller.action('match', `${SRC_C}|${BOOK_1}|reject`);
  assert.deepEqual(h.calls.find(call => call.method === 'POST' && call.path === '/owner/matches').body, { source_id: SRC_C, book_id: BOOK_1, decision: 'reject' });
  assert.match(h.last(), /<h2>Connection<\/h2>/);
});

test('loading more notes reports a failure on the page and ignores a second click while loading', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let fail = false;
  const h = appHarness(notesAnswers({ 'GET /owner/annotations': async query => {
    if (!query.cursor) return page([note(1)], 'cur2');
    await gate;
    if (fail) throw new ApiError(500, 'http_500');
    return page([note(2)]);
  } }));
  await h.controller.start('#/notes');
  fail = true;
  const first = h.controller.action('notes-more');
  await h.controller.action('notes-more');                                             // second click while the first is loading
  release();
  await first;
  assert.equal(callsTo(h, '/owner/annotations').filter(call => call.query.cursor).length, 1);
  assert.match(h.rendered.at(-1), /role="alert"[^>]*>[^<]*http_500/);
  assert.match(h.rendered.at(-1), /Show more/);                                         // the list is still there and can be retried
  assert.equal(h.controller.ctx.cache.notes.items.length, 1);
});

test('the new token is still shown when the cached page is gone, and unknown action names are ignored', async () => {
  const h = appHarness(connectionAnswers({ 'POST /owner/device/token': { device_token: 'late-token' } }));
  await h.controller.start('#/connection');
  h.controller.ctx.cache = {};
  await h.controller.submit('device-rotate', { ack: 'on' });
  assert.match(h.last(), /late-token/);
  const before = h.rendered.length;
  for (const name of ['constructor', '__proto__', 'toString']) { await h.controller.action(name, 'x'); await h.controller.submit(name, {}); }
  assert.equal(h.rendered.length, before);
});

test('actions that need a loaded page do nothing without one', async () => {
  const h = appHarness({});
  for (const [name, value] of [['book-source', SRC_A], ['book-period', '90'], ['journal-more', undefined], ['notes-more', undefined]]) await h.controller.action(name, value);
  assert.equal(h.rendered.length, 0);
  await h.controller.action('notes-archive', 'archived');                               // sets the filter and loads the notes page
  assert.equal(h.controller.ctx.noteFilters.archive, 'archived');
});

test('a note address works with an unreachable catalog and signs out on 401', async () => {
  const noteAnswers = {
    [`GET /owner/annotations/${NOTE_1}`]: detail({ context_status: 'none', kind: 'bookmark' }),
    [`GET /owner/annotations/${NOTE_1}/content`]: query => ({ annotation_id: NOTE_1, version: 3, field: query.field, text: 'x', next_cursor: null }),
  };
  const h = appHarness({ ...noteAnswers, 'GET /owner/books': new ApiError(500, 'http_500') });
  await h.controller.start(`#/notes/${NOTE_1}`);
  assert.match(h.last(), /Unknown file/);
  assert.match(h.last(), /<h2>Note<\/h2>/);
  const expired = appHarness({ ...noteAnswers, 'GET /owner/books': new ApiError(401, 'unauthorized') });
  await expired.controller.start(`#/notes/${NOTE_1}`);
  assert.match(expired.last(), /data-form="login"/);
});

test('a double submit of a reset sends one request', async () => {
  const h = appHarness(connectionAnswers({ 'POST /owner/reset': { reset_generation: 3 } }));
  await h.controller.start('#/connection');
  await Promise.all([h.controller.submit('reset', { confirm: 'reset' }), h.controller.submit('reset', { confirm: 'reset' })]);
  assert.equal(callsTo(h, '/owner/reset').length, 1);
});

test('after a mutation the flash message is announced and focused', async () => {
  const h = appHarness(connectionAnswers({ 'PUT /owner/goals/2026': (query, body) => ({ year: 2026, target: body.target, completed_unique_books: 3 }) }));
  await h.controller.start('#/connection');
  await h.controller.submit('goal-save', { target: '15' });
  assert.equal(h.lastHint(), '#flash');
  assert.match(h.last(), /id="flash" tabindex="-1" role="status"/);
  await h.controller.submit('goal-save', { target: 'x' });
  assert.equal(h.lastHint(), '#flash');
  assert.match(h.last(), /id="flash" tabindex="-1" role="alert"/);
});

test('a rotation answer that arrives after the owner navigated away is not rendered', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = appHarness(connectionAnswers({ 'POST /owner/device/token': async () => { await gate; return { device_token: 'late-secret' }; }, 'GET /owner/books': page([book(), book2()]), 'GET /owner/annotations': page([]) }));
  await h.controller.start('#/connection');
  const pending = h.controller.submit('device-rotate', { ack: 'on' });
  await h.controller.navigate('#/notes');
  const shown = h.rendered.length;
  release();
  await pending;
  assert.equal(h.rendered.length, shown);
  assert.ok(!h.rendered.some(html => html.includes('late-secret')));
});

test('a network failure while rotating says the rotation may have happened', async () => {
  const h = appHarness(connectionAnswers({ 'POST /owner/device/token': new ApiError(0, 'network') }));
  await h.controller.start('#/connection');
  await h.controller.submit('device-rotate', { ack: 'on' });
  assert.match(h.last(), /may already have been rotated[^<]*check[^<]*\(network\)/i);
});

test('a failed load of more notes is not drawn over a page the owner has left', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = appHarness(notesAnswers({ 'GET /owner/annotations': async query => { if (!query.cursor) return page([note(1)], 'cur2'); await gate; throw new ApiError(500, 'http_500'); }, 'GET /owner/device': { device_id: null, last_sync_at: null, reset_generation: 0 }, 'GET /owner/goals/2026': { year: 2026, target: 0, completed_unique_books: 0 }, 'GET /owner/matches': page([]) }));
  await h.controller.start('#/notes');
  const pending = h.controller.action('notes-more');
  await h.controller.navigate('#/connection');
  const shown = h.rendered.length;
  release();
  await pending;
  assert.equal(h.rendered.length, shown);
});

test('filters for a book that no longer exists are dropped before the list is requested', async () => {
  const h = appHarness(notesAnswers());
  h.controller.ctx.noteFilters = { search: '', book: BOOK_2, source: '', archive: 'active' };
  await h.controller.start('#/notes');
  const gone = appHarness(notesAnswers({ 'GET /owner/books': page([book()]) }));
  gone.controller.ctx.noteFilters = { search: '', book: BOOK_2, source: SRC_C, archive: 'active' };
  await gone.controller.start('#/notes');
  const query = callsTo(gone, '/owner/annotations')[0].query;
  assert.deepEqual([query.book_id, query.source_id], [undefined, undefined]);
  assert.deepEqual([gone.controller.ctx.noteFilters.book, gone.controller.ctx.noteFilters.source], ['', '']);
  assert.match(gone.last(), /<option value="" selected|<option value="">All books/);
});

test('the note page asks for a fresh catalog instead of reusing the list cache', async () => {
  const h = appHarness(notesAnswers({
    [`GET /owner/annotations/${NOTE_1}`]: detail({ context_status: 'none', kind: 'bookmark' }),
    [`GET /owner/annotations/${NOTE_1}/content`]: query => ({ annotation_id: NOTE_1, version: 3, field: query.field, text: 'x', next_cursor: null }),
  }));
  await h.controller.start('#/notes');
  await h.controller.navigate(`#/notes/${NOTE_1}`);
  assert.equal(callsTo(h, '/owner/books').length, 2);
});
