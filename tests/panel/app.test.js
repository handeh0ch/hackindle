import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../projects/frontend/js/core/api.js';
import { createController } from '../../projects/frontend/js/core/app.js';
import { addDays } from '../../projects/frontend/js/lib/format.js';

const day = (date, characters) => ({ date, characters, active_seconds: 60, volume_status: 'available', time_status: 'available' });
const summary = { characters: 4000, active_seconds: 600, conditional_pages: 2, legacy_native_pages: 0, legacy_native_seconds: 0, current_streak: 1, elapsed_days: 3,
  average_characters_per_day: 1333, average_seconds_per_day: 200, record_day: null, saved_words: 2, active_annotations: 1, volume_status: 'available', time_status: 'available' };
const book = { book_id: 'b1', title: 'Synthetic', authors: [], sources: [], active_annotations: 0, archived_annotations: 0, most_recent_source_id: null, first_tracked_at: null, last_tracked_at: null, active_days: 0 };

function harness(overrides = {}) {
  const calls = [], rendered = [];
  const answers = {
    '/owner/config': { characters_per_page: 2000 },
    '/owner/statistics/summary': summary,
    '/owner/statistics/daily': query => ({ days: [day(query.to, 1000)], summary }),
    '/owner/vocabulary': { status: 'available', count: 2, items: [], next_cursor: null },
    '/owner/goals/2026': { year: 2026, target: 5, completed_unique_books: 1 },
    ...overrides,
  };
  const api = {
    async get(path, query) {
      calls.push([path, query]);
      const answer = answers[path];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(query) : answer;
    },
    async pages(path, query) { calls.push([path, query]); return { items: [book], complete: true }; },
    session: async () => { if (answers.session instanceof Error) throw answers.session; return { owner: { username: 'o' }, csrf_token: 't' }; },
    async login(username, password) { calls.push(['login', { username, password }]); if (answers.login instanceof Error) throw answers.login; },
    async logout() { calls.push(['logout']); },
  };
  const controller = createController({ api, render: html => rendered.push(html), today: () => '2026-11-08' });
  return { controller, calls, rendered, last: () => rendered.at(-1) };
}

test('date arithmetic crosses month, year and leap boundaries', () => {
  assert.equal(addDays('2026-11-08', -29), '2026-10-10');
  assert.equal(addDays('2026-01-03', -5), '2025-12-29');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
});

test('a signed-in owner sees the overview with loading first', async () => {
  const h = harness();
  await h.controller.start('');
  assert.match(h.rendered[0], /role="status"/);
  assert.match(h.last(), /Reading volume/);
  assert.match(h.last(), /2026 calendar/);
  const ranges = h.calls.filter(([path]) => path === '/owner/statistics/daily').map(([, query]) => [query.from, query.to]);
  assert.deepEqual(ranges.sort(), [['2026-01-01', '2026-12-31'], ['2026-10-10', '2026-11-08']].sort());
  assert.ok(h.calls.some(([path, query]) => path === '/owner/vocabulary' && query.limit === 1));
});

test('without a session the login form appears and signing in continues to the overview', async () => {
  const h = harness({ session: new ApiError(401, 'unauthorized') });
  await h.controller.start('#/books');
  assert.match(h.last(), /data-form="login"/);
  assert.match(h.last(), /type="password"/);
  await h.controller.submit('login', { username: 'owner', password: 'secret' });
  assert.deepEqual(h.calls.find(([name]) => name === 'login'), ['login', { username: 'owner', password: 'secret' }]);
  assert.match(h.last(), /Library/);   // returns to the route that was requested
});

test('a failed sign-in shows a generic message without echoing credentials', async () => {
  const h = harness({ session: new ApiError(401, 'unauthorized'), login: new ApiError(401, 'invalid_credentials') });
  await h.controller.start('');
  await h.controller.submit('login', { username: 'owner', password: 'hunter2-secret' });
  assert.match(h.last(), /Wrong username or password/);
  assert.ok(!h.last().includes('hunter2-secret'));
  const throttled = harness({ session: new ApiError(401, 'unauthorized'), login: new ApiError(429, 'too_many_attempts') });
  await throttled.controller.start('');
  await throttled.controller.submit('login', { username: 'o', password: 'p' });
  assert.match(throttled.last(), /Too many attempts/);
  const offline = harness({ session: new ApiError(401, 'unauthorized'), login: new ApiError(0, 'network') });
  await offline.controller.start('');
  await offline.controller.submit('login', { username: 'o', password: 'p' });
  assert.match(offline.last(), /Could not reach the server/);
});

test('a 401 during a view asks for sign-in again', async () => {
  const h = harness({ '/owner/statistics/summary': new ApiError(401, 'unauthorized') });
  await h.controller.start('');
  assert.match(h.last(), /data-form="login"/);
});

test('API failures show an error state and retry reloads the view', async () => {
  let failing = true;
  const h = harness({ '/owner/statistics/summary': () => { if (failing) throw new ApiError(500, 'http_500'); return summary; } });
  await h.controller.start('');
  assert.match(h.last(), /role="alert"[^>]*>.*http_500/s);
  failing = false;
  await h.controller.action('retry');
  assert.match(h.last(), /Reading volume/);
  const down = harness({ '/owner/config': new ApiError(0, 'network') });
  await down.controller.start('');
  assert.match(down.last(), /network/);
});

test('period and metric choices re-render the overview', async () => {
  const h = harness();
  await h.controller.start('');
  await h.controller.action('period', '30');
  assert.match(h.last(), /aria-pressed="true"[^>]*>30 days/);
  await h.controller.action('metric', 'time');
  assert.match(h.last(), /aria-pressed="true"[^>]*>Time/);
  await h.controller.action('period', '5');   // unsupported values are ignored
  assert.match(h.last(), /aria-pressed="true"[^>]*>30 days/);
});

test('the library lists grouped books and searches through the API', async () => {
  const h = harness();
  await h.controller.start('#/books');
  assert.match(h.last(), /href="#\/books\/b1"/);
  await h.controller.submit('search', { q: 'dune' });
  const call = h.calls.filter(([path]) => path === '/owner/books').at(-1);
  assert.equal(call[1].search, 'dune');
  assert.match(h.last(), /value="dune"/);
});

test('unknown routes fall back to the overview and routes can be added', async () => {
  const h = harness();
  await h.controller.navigate('#/nowhere');
  assert.match(h.last(), /Reading volume/);
  const calls = [];
  const custom = createController({ api: { session: async () => ({}), get: async () => ({}) }, render: html => calls.push(html), today: () => '2026-11-08', routes: { overview: async () => '<h2>custom</h2>' } });
  await custom.navigate('#/overview');
  assert.equal(calls.at(-1), '<h2>custom</h2>');
});

test('without an injected date the controller uses the instance timezone and an injected clock', async () => {
  const calls = [];
  const api = {
    session: async () => ({}),
    async get(path, query) {
      calls.push([path, query]);
      if (path === '/owner/config') return { characters_per_page: 2000, reporting_timezone: 'Pacific/Kiritimati' };
      if (path === '/owner/statistics/daily') return { days: [], summary };
      return path === '/owner/statistics/summary' ? summary : path === '/owner/vocabulary' ? { status: 'unavailable', count: null, items: [], next_cursor: null } : { year: 2026, target: 0, completed_unique_books: 0 };
    },
  };
  // 20:00 UTC on 8 Nov is already 9 Nov at UTC+14, so a UTC or browser-zone date would fail.
  const controller = createController({ api, render: () => {}, now: () => new Date('2026-11-08T20:00:00Z') });
  await controller.start('');
  assert.equal(controller.ctx.today(), '2026-11-09');
  assert.equal(calls[0][0], '/owner/config');
  const ranges = calls.filter(([path]) => path === '/owner/statistics/daily').map(([, query]) => query.to).sort();
  assert.deepEqual(ranges, ['2026-11-09', '2026-12-31']);
});

test('a slow view never overwrites a newer navigation', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness({ '/owner/statistics/summary': async () => { await gate; return summary; } });
  const slow = h.controller.navigate('#/overview');
  await h.controller.navigate('#/books');
  release();
  await slow;
  assert.match(h.last(), /Library/);
  assert.equal(h.controller.ctx.hash, '#/books');
});

test('inherited object keys are not routes', async () => {
  const h = harness();
  for (const hash of ['#/constructor', '#/__proto__', '#/toString/x']) {
    await h.controller.navigate(hash);
    assert.match(h.last(), /Reading volume/, hash);
  }
});

test('period and metric changes reuse loaded data and hand focus back to the pressed control', async () => {
  const h = harness();
  const hints = [];
  const controller = createController({ api: h.controller.ctx.api, render: (html, hint) => { h.rendered.push(html); hints.push(hint); }, today: () => '2026-11-08' });
  await controller.start('');
  const fetched = h.calls.length;
  await controller.action('period', '30');
  await controller.action('metric', 'time');
  assert.equal(h.calls.length, fetched);                       // no refetch
  assert.ok(!h.rendered.slice(-2).some(html => /Loading/.test(html)));
  assert.deepEqual(hints.slice(-2), ['[data-period="30"]', '[data-metric="time"]']);
  await controller.action('retry');
  assert.ok(h.calls.length > fetched);                          // retry does reload
});

test('year arrows load another year, stay within the past and never beyond this year', async () => {
  const h = harness({ '/owner/goals/2025': { year: 2025, target: 0, completed_unique_books: 0 } });
  await h.controller.start('');
  await h.controller.action('year', '1');                       // already the current year: ignored
  assert.equal(h.controller.ctx.year ?? 2026, 2026);            // null means the current year
  await h.controller.action('year', '-1');
  assert.equal(h.controller.ctx.year, 2025);
  assert.ok(h.calls.some(([path, query]) => path === '/owner/statistics/daily' && query.from === '2025-01-01' && query.to === '2025-12-31'));
  assert.match(h.last(), /2025 calendar/);
  assert.ok(!/data-value="1" aria-label="Next year" disabled/.test(h.last()));
  await h.controller.action('year', '1');
  assert.match(h.last(), /2026 calendar/);
  assert.match(h.last(), /aria-label="Next year" disabled/);
});

test('the calendar layout follows the screen width without reloading', async () => {
  const h = harness();
  await h.controller.start('');
  assert.match(h.last(), /viewBox="0 0 408 244"/);               // two half-year blocks by default
  const before = h.calls.length;
  await h.controller.action('layout', 'single');
  assert.match(h.last(), /viewBox="0 0 77\d 1[0-3]\d"/);
  await h.controller.action('layout', 'nonsense');                // unknown values fall back to the default
  assert.match(h.last(), /viewBox="0 0 408 244"/);
  assert.equal(h.calls.length, before);
});

test('a failed sign-out is reported instead of pretending to succeed', async () => {
  const h = harness();
  await h.controller.start('');
  h.controller.ctx.api.logout = async () => { throw new ApiError(500, 'http_500'); };
  await h.controller.action('logout');
  assert.match(h.last(), /Could not sign out/);
  assert.ok(!/data-form="login"/.test(h.last()));
});

test('signing out clears the view', async () => {
  const h = harness();
  await h.controller.start('');
  await h.controller.action('logout');
  assert.ok(h.calls.some(([name]) => name === 'logout'));
  assert.match(h.last(), /data-form="login"/);
});
