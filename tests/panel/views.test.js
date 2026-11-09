import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, stateHtml, overviewHtml, libraryHtml, lineChartSvg, heatmapSvg, chartTableHtml, calendarTableHtml } from '../../projects/frontend/js/views/views.js';
import { buildLibrary } from '../../projects/frontend/js/models/books.js';
import { buildOverview } from '../../projects/frontend/js/models/overview.js';
import { buildYear } from '../../projects/frontend/js/models/calendar.js';

test('escaping covers every HTML-significant character', () => {
  assert.equal(esc(`<script>alert("x")&'y'</script>`), '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;y&#39;&lt;/script&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(5), '5');
});

test('state placeholders announce themselves to assistive technology', () => {
  assert.match(stateHtml('loading'), /role="status"/);
  assert.match(stateHtml('error', 'http_500'), /role="alert"[^>]*>.*http_500/s);
  assert.match(stateHtml('empty', 'Nothing yet'), /Nothing yet/);
  assert.match(stateHtml('unavailable'), /unavailable/i);
  assert.match(stateHtml('unauthorized'), /Sign in/);
  assert.match(stateHtml('error', '<b>'), /&lt;b&gt;/);
});

const day = (date, characters) => ({ date, characters, active_seconds: 60, volume_status: characters === null ? 'unavailable' : 'available', time_status: 'available' });
const model = () => buildOverview({
  config: { characters_per_page: 2000 },
  summary: { characters: 4000, active_seconds: 600, conditional_pages: 2, legacy_native_pages: 0, legacy_native_seconds: 0, current_streak: 1, elapsed_days: 3,
    average_characters_per_day: 1333, average_seconds_per_day: 200, record_day: null, saved_words: null, active_annotations: 0, volume_status: 'available', time_status: 'available' },
  days: [day('2026-11-06', 1000), day('2026-11-07', null), day('2026-11-08', 3000)],
  vocabulary: { status: 'unavailable', count: null, items: [], next_cursor: null }, goal: { year: 2026, target: 0, completed_unique_books: 0 }, period: 7,
});

test('overview markup has cards, a chart with a table alternative and period buttons', () => {
  const html = overviewHtml({ model: model(), period: 7, metric: 'volume', year: 2026, perPage: 1500, calendar: buildYear({ year: 2026, days: [day('2026-11-08', 3000)], metric: 'volume', today: '2026-11-08' }) });
  assert.match(html, /8 Nov 2026: 2 pages/);   // tooltips use the instance page size (3000 / 1500), not a default
  assert.match(html, /Show calendar as table/);
  assert.match(html, /<th scope="row">Nov<\/th><td>≥ 2 pages<\/td><td>7<\/td>/);   // 7 elapsed days have no data
  assert.match(html, /<h2[^>]*>Overview/);
  assert.match(html, /Reading volume/);
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(html, /<table[^>]*>.*<caption>/s);
  assert.match(html, /aria-pressed="true"[^>]*>7 days/);
  assert.match(html, /data-period="30"/);
  assert.match(html, /data-metric="time"/);
  assert.match(html, /<div class="scroll" role="region" aria-label="Calendar, scrollable" tabindex="0"><svg class="heatmap"/);
  assert.match(html, /—/);   // unavailable values stay a dash
});

test('every overview card is identical in markup, in one grid, in the model order', () => {
  const html = overviewHtml({ model: model(), period: 7, metric: 'volume', year: 2026, perPage: 2000, calendar: buildYear({ year: 2026, days: [], metric: 'volume', today: '2026-11-08' }) });
  assert.equal((html.match(/<section class="cards"/g) ?? []).length, 1);
  assert.ok(!/class="(band|figures|details)"|band-cell|card figure|card detail/.test(html));
  const cards = html.slice(html.indexOf('<section class="cards"'), html.indexOf('</section>', html.indexOf('<section class="cards"')));
  assert.deepEqual([...cards.matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1]),
    ['Reading volume', 'Active reading time', 'Current streak', 'Daily average', 'Record day', 'Saved words', 'Active notes', 'Reading goal 2026']);
  const shapes = new Set([...cards.matchAll(/<article class="card (\w+)">/g)].map(() => 'card'));
  assert.equal([...cards.matchAll(/<article class="card /g)].length, 8);
  assert.equal(shapes.size, 1);
});

test('the calendar uses two half-year blocks and year arrows', () => {
  const grid = buildYear({ year: 2024, days: [day('2024-02-29', 4000)], metric: 'volume', today: '2024-12-31' });
  const svg = heatmapSvg(grid, 2000);
  const width = Number(/viewBox="0 0 (\d+) (\d+)"/.exec(svg)[1]), height = Number(/viewBox="0 0 (\d+) (\d+)"/.exec(svg)[2]);
  assert.ok(width < 460 && height > 190, `${width}x${height}`);   // 27 weeks wide, two stacked blocks
  assert.equal((svg.match(/<rect /g) ?? []).length, 366);
  assert.match(svg, /<rect class="cell level-4" data-date="2024-02-29"/);
  const html = overviewHtml({ model: model(), period: 7, metric: 'volume', year: 2024, perPage: 2000, calendar: grid, canNext: false });
  assert.match(html, /data-action="year" data-value="-1" aria-label="Previous year"/);
  assert.match(html, /data-action="year" data-value="1" aria-label="Next year" disabled/);
  assert.ok(!/class="bubble"|selected/.test(html));                // a day is read in the hover tooltip, not under the calendar
  assert.ok(!/ disabled/.test(overviewHtml({ model: model(), period: 7, metric: 'volume', year: 2024, perPage: 2000, calendar: grid, canNext: true })));
});

test('hover tooltips carry the full day text in data-tip, with no native title tooltips', () => {
  const grid = buildYear({ year: 2024, days: [day('2024-02-29', 4000), { ...day('2024-03-01', 2000), volume_status: 'partial' }], metric: 'volume', today: '2024-03-02' });
  const svg = heatmapSvg(grid, 2000);
  assert.match(svg, /data-date="2024-02-29"[^>]*data-tip="Thu 29 Feb 2024: 2 pages"/);
  assert.match(svg, /data-tip="Fri 1 Mar 2024: ≥ 1 page"/);
  assert.match(svg, /data-tip="Sat 2 Mar 2024: —"/);
  assert.match(svg, /data-tip="Sun 3 Mar 2024: future day"/);
  assert.ok(!/<rect [^>]*><title>/.test(svg));
  assert.equal((svg.match(/<title>/g) ?? []).length, 0);
  assert.equal((svg.match(/data-tip="/g) ?? []).length, 366);
  const chart = lineChartSvg(model().chart);
  // Every day gets an invisible, larger hover target in front of its visible point, so a 7px dot is easy to hit.
  assert.match(chart, /<circle class="hit" cx="[\d.]+" cy="[\d.]+" r="11" data-tip="6 Nov 2026: 0\.5 pages"><\/circle><circle class="point available"/);
  assert.match(chart, /<circle class="hit"[^>]*data-tip="7 Nov 2026: —"/);
  assert.equal((chart.match(/class="hit"/g) ?? []).length, 3);       // two measured days and the unavailable one
  assert.ok(!/<(circle class="point|line class="gap")[^>]*data-tip/.test(chart));
  assert.equal((chart.match(/<title>/g) ?? []).length, 1);          // only the chart's own description remains
});

test('on wide screens the year is one block that is wide and short', () => {
  const grid = buildYear({ year: 2024, days: [day('2024-02-29', 4000)], metric: 'volume', today: '2024-12-31' });
  const svg = heatmapSvg(grid, 2000, 'single');
  const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg).map(Number);
  assert.ok(width >= 700 && height <= 130 && width / height > 5.5, `${width}x${height}`);
  assert.equal((svg.match(/<rect /g) ?? []).length, 366);
  assert.equal((svg.match(/class="axis"[^>]*>Mon</g) ?? []).length, 1);     // weekday labels once
  assert.equal((svg.match(/>Jan<|>Dec</g) ?? []).length, 2);
  assert.match(svg, /<rect class="cell level-4" data-date="2024-02-29" x="\d+" y="\d+"/);
  assert.equal(heatmapSvg(grid, 2000, 'halves'), heatmapSvg(grid, 2000));    // halves stays the default
  const html = overviewHtml({ model: model(), period: 7, metric: 'volume', year: 2024, perPage: 2000, calendar: grid, layout: 'single' });
  assert.match(html, /viewBox="0 0 7\d\d 1[0-3]\d" role="img" aria-label="2024 reading calendar/);
});

test('the calendar table alternative gives monthly totals and marks incomplete months', () => {
  const grid = buildYear({ year: 2026, days: [day('2026-01-05', 4000), { ...day('2026-02-03', 2000), volume_status: 'partial' }], metric: 'volume', today: '2026-02-28' });
  const html = calendarTableHtml(grid, 2000);
  assert.match(html, /<th scope="row">Jan<\/th><td>≥ 2 pages<\/td><td>30<\/td>/);   // 30 January days have no data
  assert.match(html, /<th scope="row">Feb<\/th><td>≥ 1 page<\/td>/);
  assert.match(html, /<th scope="row">Mar<\/th><td>—<\/td><td>0<\/td>/);          // future month: nothing measured, nothing missing
  const time = calendarTableHtml(buildYear({ year: 2026, days: [day('2026-01-05', 4000)], metric: 'time', today: '2026-01-31' }), 2000);
  assert.match(time, /1 min/);
});

test('partial values keep their marker in tooltips', () => {
  const partial = buildYear({ year: 2026, days: [{ ...day('2026-01-05', 4000), volume_status: 'partial' }], metric: 'volume', today: '2026-01-31' });
  assert.match(heatmapSvg(partial, 2000), /5 Jan 2026: ≥ 2 pages/);
});

test('empty overview explains that nothing is tracked yet', () => {
  assert.match(overviewHtml({ model: { state: 'empty', cards: [], chart: { bars: [], max: 0, period: 14 } }, period: 14, metric: 'volume', year: 2026, calendar: null }), /No reading history yet/);
});

test('charts mark unavailable days differently from measured days', () => {
  const svg = lineChartSvg(model().chart);
  assert.equal((svg.match(/class="point /g) ?? []).length, 2);
  assert.equal((svg.match(/class="gap"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="line"/g) ?? []).length, 0);   // a gap between single days draws no connecting line
  assert.match(svg, /<title>.*conditional pages/s);
  assert.match(chartTableHtml(model().chart), /<th scope="row">7 Nov 2026<\/th><td>—<\/td>/);
});

test('the line chart breaks at unavailable days and keeps the partial marker on values', () => {
  const chart = { period: 7, max: 3, bars: [
    { date: '2026-11-02', value: 1, state: 'available', label: 'a' }, { date: '2026-11-03', value: 3, state: 'partial', label: 'b' },
    { date: '2026-11-04', value: null, state: 'unavailable', label: 'c' },
    { date: '2026-11-05', value: 2, state: 'available', label: 'd' }, { date: '2026-11-06', value: 0, state: 'available', label: 'e' }] };
  const svg = lineChartSvg(chart);
  assert.equal((svg.match(/class="line"/g) ?? []).length, 2);     // two runs, no line across the gap
  assert.equal((svg.match(/class="area"/g) ?? []).length, 2);
  assert.equal((svg.match(/class="gap"/g) ?? []).length, 1);
  assert.match(svg, /<circle class="point partial"/);
  assert.match(svg, />≥ 3<\/text>/);
  assert.match(svg, />Mon<\/text>.*>Fri<\/text>/s);                // a week is labelled by weekday
  assert.match(svg, /viewBox="0 0 400 240"/);
  assert.match(lineChartSvg(chart, 'single'), /viewBox="0 0 880 220"/);
  const month = { period: 30, max: 1, bars: Array.from({ length: 30 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, value: 1, state: 'available', label: 'x' })) };
  const long = lineChartSvg(month);
  assert.ok(!/class="value"/.test(long));                           // 30 points: no crowded value labels
  assert.match(long, />30 Oct<\/text>/);
  assert.equal((long.match(/class="tick"/g) ?? []).length, 6);
  assert.match(lineChartSvg({ period: 14, max: 0, bars: [] }), /class="baseline"/);
});

test('the heatmap draws one rect per day with a readable title', () => {
  const grid = buildYear({ year: 2024, days: [day('2024-02-29', 2000)], metric: 'volume', today: '2024-12-31' });
  const svg = heatmapSvg(grid, 2000);
  assert.equal((svg.match(/<rect /g) ?? []).length, 366);
  assert.match(svg, /data-tip="Thu 29 Feb 2024: 1 page"/);
  assert.match(svg, /class="cell level-4"/);
  assert.match(svg, /class="cell unavailable"/);
  assert.match(heatmapSvg(buildYear({ year: 2026, days: [], metric: 'time', today: '2026-01-02' })), /class="cell future"/);
});

test('the library escapes titles, links cards and reports its states', () => {
  const book = { book_id: 'b1', title: '<img src=x onerror=1>', authors: [], sources: [], active_annotations: 0, archived_annotations: 0, most_recent_source_id: null, first_tracked_at: null, last_tracked_at: null, active_days: 0 };
  const html = libraryHtml({ library: buildLibrary({ books: [book], search: '' }), search: '' });
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(html, /href="#\/books\/b1"/);
  assert.match(libraryHtml({ library: buildLibrary({ books: [], search: '' }), search: '' }), /No books yet/);
  assert.match(libraryHtml({ library: buildLibrary({ books: [], search: 'zz' }), search: 'zz' }), /No book matches/);
  assert.match(libraryHtml({ library: buildLibrary({ books: [book], search: '', complete: false }), search: '' }), /Showing the first/);
});
