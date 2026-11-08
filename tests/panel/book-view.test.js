import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBookPage } from '../../public/js/book.js';
import { bookHtml, bookChartSvg } from '../../public/js/book-view.js';
import { SRC_A, SRC_B, book, day, sample, session } from './fixtures.js';

const days = [day('2026-11-05', 2000), day('2026-11-06', null), day('2026-11-07', 4000, 60, { volume_status: 'partial' }), day('2026-11-08', 0)];
function model(patch = {}) {
  return buildBookPage({ book: book({ title: 'Дом <b>& "Co"</b>' }), sourceId: SRC_A, days: 30, daily: days, progress: [sample(0.3, '2026-11-05T09:00:00Z'), sample(0.5, '2026-11-07T20:00:00Z')],
    sessions: [session(1), session(2, { characters: 0 }), session(3, { characters: null, volume_status: 'unavailable' })], sessionsComplete: true, cycles: [], shown: 10, perPage: 2000,
    today: '2026-11-08', timeZone: 'UTC', progressComplete: true, ...patch });
}

test('the book page names the book, escapes it and offers one tab per source', () => {
  const html = bookHtml(model(), { layout: 'halves' });
  assert.match(html, /<h2>Дом &lt;b&gt;&amp; &quot;Co&quot;&lt;\/b&gt;<\/h2>/);
  assert.ok(!html.includes('<b>'));
  assert.match(html, /A\. Writer/);
  assert.match(html, /role="group" aria-label="Source file"/);
  assert.match(html, /data-action="book-source" data-value="a{64}" aria-pressed="true">EPUB · 40%/);
  assert.match(html, /data-action="book-source" data-value="b{64}" aria-pressed="false">PDF · 70%/);
  assert.match(html, /own progress/i);
  assert.ok(!/ style=/.test(html));
  assert.ok(!/<script/i.test(html));
});

test('period choices, summary cards and the chart table alternative are present', () => {
  const html = bookHtml(model(), { layout: 'halves' });
  assert.match(html, /data-action="book-period" data-value="30" aria-pressed="true">30 days/);
  assert.match(html, /data-action="book-period" data-value="365" aria-pressed="false">1 year/);
  assert.match(html, /<h3>Pages read<\/h3>/);
  assert.match(html, /<h3>Active time<\/h3>/);
  assert.match(html, /<h3>Active days<\/h3>/);
  assert.match(html, /<details><summary>Show chart as table<\/summary><table class="chart-table">/);
  assert.match(html, /<th scope="row">6 Nov 2026<\/th><td>—<\/td><td>—<\/td>/);
  assert.match(html, /<th scope="row">5 Nov 2026<\/th><td>1 page<\/td><td>30%<\/td>/);
  assert.match(html, /<th scope="row">7 Nov 2026<\/th><td>≥ 2 pages<\/td><td>50%<\/td>/);
});

test('the chart has bars, a second axis, gaps for unavailable days and no joined progress across missing days', () => {
  const svg = bookChartSvg(model().chart, 'halves');
  assert.match(svg, /<svg class="chart book-chart" viewBox="0 0 400 \d+" role="img"/);
  assert.equal((svg.match(/class="bar available"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="bar partial"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="gap"/g) ?? []).length, 1);                 // 6 Nov: no data, never a zero bar
  assert.equal((svg.match(/data-tip="/g) ?? []).length, 4);
  assert.match(svg, /data-tip="6 Nov 2026: —"/);
  assert.equal((svg.match(/class="progress-point"/g) ?? []).length, 2);
  assert.equal((svg.match(/class="progress-line"/g) ?? []).length, 0);        // 5 and 7 Nov are not adjacent: no line across the unobserved day
  assert.match(svg, />100%<\/text>/);
  assert.match(svg, /class="axis-left"[^>]*>2<\/text>/);
  assert.match(bookChartSvg(model().chart, 'single'), /viewBox="0 0 880 \d+"/);
  assert.equal((bookChartSvg(model({ progress: [] }).chart).match(/progress-line/g) ?? []).length, 0);
  assert.match(bookHtml(model({ progress: [] })), /No progress recorded in this period/);
});

test('long periods label months rather than every day', () => {
  const year = Array.from({ length: 365 }, (_, index) => day(new Date(Date.UTC(2025, 10, 9 + index)).toISOString().slice(0, 10), index % 7 === 0 ? null : 1000));
  const svg = bookChartSvg(model({ days: 365, daily: year }).chart, 'single');
  const ticks = [...svg.matchAll(/class="tick"[^>]*>([^<]*)</g)].map(match => match[1]);
  assert.ok(ticks.length >= 11 && ticks.length <= 13, ticks.join());
  assert.ok(ticks.includes('Jan'));
});

test('the journal shows newest sessions with re-reads and unavailable values, and a Show 10 more button only when needed', () => {
  const html = bookHtml(model(), { layout: 'halves' });
  assert.match(html, /<h3 id="journal-title" tabindex="-1">Reading journal<\/h3>/);
  assert.match(html, /0 new pages \(re-read\)/);
  assert.match(html, /<span class="amount unavailable">—<\/span>/);
  assert.ok(!/data-action="journal-more"/.test(html));
  const many = Array.from({ length: 13 }, (_, index) => session(1, { session_id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`, started_at: `2026-10-${String(10 + index).padStart(2, '0')}T10:00:00Z` }));
  const paged = bookHtml(model({ sessions: many }), { layout: 'halves' });
  assert.equal((paged.match(/<li class="session"/g) ?? []).length, 10);
  assert.match(paged, /<button type="button" data-action="journal-more">Show 10 more<\/button>/);
  assert.match(paged, /3 older/);
  assert.match(bookHtml(model({ sessions: [] })), /No sessions recorded for this file yet/);
  const cut = bookHtml(model({ sessionsComplete: false }));
  assert.match(cut, /Some sessions, of any age, are not listed/);
  assert.ok(!/newest first|older ones may be missing/.test(cut));
  assert.match(bookHtml(model()), /newest first/);
});

test('cycles list only the explicit ones', () => {
  const cycles = [{ cycle_id: '20000000-0000-4000-8000-000000000001', source_id: SRC_B, started_at: '2026-10-01T00:00:00Z', finished_at: '2026-10-20T12:00:00Z' },
    { cycle_id: '20000000-0000-4000-8000-000000000002', source_id: SRC_B, started_at: '2026-11-03T00:00:00Z', finished_at: null }];
  const html = bookHtml(model({ cycles }), { layout: 'halves' });
  assert.match(html, /<li class="cycle">Cycle 1: started 1 Oct 2026, finished 20 Oct 2026<\/li>/);
  assert.match(html, /<li class="cycle">Cycle 2: started 3 Nov 2026, not finished<\/li>/);
  assert.match(bookHtml(model(), { layout: 'halves' }), /No reading cycles recorded/);
});

test('extra sections and the flash message are placed on the page', () => {
  const html = bookHtml(model(), { layout: 'halves', grouping: '<section id="grouping-test"></section>', flash: '<p class="state ok" role="status">Done</p>' });
  assert.match(html, /<p class="state ok" role="status">Done<\/p>/);
  assert.match(html, /id="grouping-test"/);
  assert.ok(html.indexOf('Done') < html.indexOf('<h2>'));
});

test('the progress line joins only consecutive observed days', () => {
  const progress = [sample(0.3, '2026-11-05T09:00:00Z'), sample(0.4, '2026-11-06T09:00:00Z'), sample(0.6, '2026-11-08T09:00:00Z')];
  const svg = bookChartSvg(model({ progress }).chart, 'halves');
  assert.equal((svg.match(/class="progress-point"/g) ?? []).length, 3);
  const lines = [...svg.matchAll(/class="progress-line" d="([^"]+)"/g)].map(match => match[1]);
  assert.equal(lines.length, 1);
  assert.equal((lines[0].match(/[ML]/g) ?? []).length, 2);                        // 5 and 6 Nov only; 8 Nov stands alone
});

test('a cut-off progress history says the newest observations are missing', () => {
  const html = bookHtml(model({ progressComplete: false }));
  assert.match(html, /Newer progress observations are missing/);
  assert.ok(!/older observations/i.test(html));
  assert.ok(!/Newer progress observations are missing/.test(bookHtml(model())));
});

test('cut-off cycles are named without numbers and flagged', () => {
  const cycles = [{ cycle_id: '20000000-0000-4000-8000-000000000001', source_id: SRC_B, started_at: '2026-10-01T00:00:00Z', finished_at: null }];
  const html = bookHtml(model({ cycles, cyclesComplete: false }));
  assert.match(html, /<li class="cycle">Cycle: started 1 Oct 2026, not finished<\/li>/);
  assert.match(html, /Some cycles may not be listed/);
  assert.ok(!/Some cycles may not be listed/.test(bookHtml(model({ cycles }))));
});
