import test from 'node:test';
import assert from 'node:assert/strict';
import { PERIOD_CHOICES, chooseSource, sourceTabs, buildSummary, buildBookChart, buildJournal, newPagesText } from '../../public/js/book.js';
import { SRC_A, SRC_B, book, source, sample, day, session } from './fixtures.js';

test('the source defaults to the most recent one and an unknown choice falls back', () => {
  const grouped = book();
  assert.equal(chooseSource(grouped, null), SRC_B);
  assert.equal(chooseSource(grouped, SRC_A), SRC_A);
  assert.equal(chooseSource(grouped, 'f'.repeat(64)), SRC_B);
  assert.equal(chooseSource(book({ most_recent_source_id: null }), null), SRC_A);
  assert.equal(chooseSource(book({ most_recent_source_id: 'f'.repeat(64) }), null), SRC_A);
  assert.deepEqual(PERIOD_CHOICES, [30, 90, 365]);
});

test('each source tab carries its own progress and same formats are told apart', () => {
  const tabs = sourceTabs(book(), SRC_A);
  assert.deepEqual(tabs.map(tab => [tab.id, tab.label, tab.progress, tab.selected]), [[SRC_A, 'EPUB', '40%', true], [SRC_B, 'PDF', '70%', false]]);
  const twins = sourceTabs(book({ sources: [source(SRC_A, 'epub'), source(SRC_B, 'epub', { progress: sample(0.1) })] }), SRC_B);
  assert.deepEqual(twins.map(tab => [tab.label, tab.progress, tab.selected]), [['EPUB 1', '—', false], ['EPUB 2', '10%', true]]);
});

test('new pages: a measured zero is a re-read, null is unavailable, tiny amounts are not zero', () => {
  assert.equal(newPagesText(0, 'available', 2000), '0 new pages (re-read)');
  assert.equal(newPagesText(null, 'unavailable', 2000), '—');
  assert.equal(newPagesText(2000, 'available', 2000), '1 new page');
  assert.equal(newPagesText(3000, 'available', 2000), '1.5 new pages');
  assert.equal(newPagesText(3000, 'partial', 2000), '≥ 1.5 new pages');
  assert.equal(newPagesText(0, 'partial', 2000), '≥ 0 new pages');
  assert.equal(newPagesText(20, 'available', 2000), '<0.1 new pages');
  assert.equal(newPagesText(0, 'available', 2000, true), '0 new pages');      // a session still running is not yet a re-read
});

test('the period summary adds measured days and marks missing ones instead of counting zero', () => {
  const days = [day('2026-11-05', 4000, 600), day('2026-11-06', null), day('2026-11-07', 0, 0), day('2026-11-08', 2000, 300), day('2026-11-09', null)];
  const summary = buildSummary({ days, perPage: 2000, today: '2026-11-08' });
  assert.deepEqual(summary.pages, { text: '≥ 3 pages', state: 'partial' });
  assert.deepEqual(summary.minutes, { text: '≥ 15 min', state: 'partial' });
  assert.deepEqual(summary.activeDays, { text: '≥ 2', state: 'partial' });
  const full = buildSummary({ days: [day('2026-11-07', 0, 0), day('2026-11-08', 3000, 120)], perPage: 2000, today: '2026-11-08' });
  assert.deepEqual(full.pages, { text: '1.5 pages', state: 'available' });
  assert.deepEqual(full.activeDays, { text: '1', state: 'available' });
  assert.equal(buildSummary({ days: [day('2026-11-07', 0, 0)], perPage: 2000, today: '2026-11-08' }).pages.text, '0 pages');
  const none = buildSummary({ days: [day('2026-11-07', null), day('2026-11-08', null)], perPage: 2000, today: '2026-11-08' });
  assert.deepEqual([none.pages.text, none.minutes.text, none.activeDays.text], ['—', '—', '—']);
  assert.equal(buildSummary({ days: [], perPage: 2000, today: '2026-11-08' }).pages.state, 'unavailable');
  const partialDay = buildSummary({ days: [day('2026-11-08', 2000, 60, { volume_status: 'partial', time_status: 'partial' })], perPage: 2000, today: '2026-11-08' });
  assert.deepEqual([partialDay.pages.text, partialDay.minutes.text], ['≥ 1 page', '≥ 1 min']);
});

test('the chart pairs daily pages with the latest progress of the same source and never interpolates', () => {
  const days = [day('2026-11-05', 2000), day('2026-11-06', null), day('2026-11-07', 4000, 60, { volume_status: 'partial' }), day('2026-11-08', 0)];
  const progress = [
    sample(0.5, '2026-11-07T20:00:00Z'), sample(0.2, '2026-11-05T09:00:00Z'), sample(0.3, '2026-11-05T21:00:00Z'),   // unsorted on purpose
    sample(0.1, '2026-10-01T09:00:00Z'), sample(0.9, 'not a date'),                                                   // outside the window, invalid
  ];
  const chart = buildBookChart({ days, progress, perPage: 2000, today: '2026-11-08', timeZone: 'UTC' });
  assert.deepEqual(chart.bars.map(bar => [bar.date, bar.value, bar.state, bar.percent]), [
    ['2026-11-05', 1, 'available', 30], ['2026-11-06', null, 'unavailable', null], ['2026-11-07', 2, 'partial', 50], ['2026-11-08', 0, 'available', null]]);
  assert.equal(chart.bars[0].label, '5 Nov 2026: 1 page, progress 30%');
  assert.equal(chart.bars[1].label, '6 Nov 2026: —');
  assert.equal(chart.bars[2].label, '7 Nov 2026: ≥ 2 pages, progress 50%');
  assert.equal(chart.max, 2);
  assert.equal(chart.hasProgress, true);
});

test('progress days follow the reporting timezone, not the browser', () => {
  const chart = buildBookChart({ days: [day('2026-11-08', 1000), day('2026-11-09', 1000)], progress: [sample(0.5, '2026-11-08T20:00:00Z')], perPage: 2000, today: '2026-11-09', timeZone: 'Pacific/Kiritimati' });
  assert.deepEqual(chart.bars.map(bar => bar.percent), [null, 50]);   // 20:00 UTC is already the 9th at UTC+14
  assert.equal(buildBookChart({ days: [], progress: [], perPage: 2000, today: '2026-11-09', timeZone: 'UTC' }).hasProgress, false);
});

test('the axis maximum is a round number above the largest day', () => {
  const max = value => buildBookChart({ days: [day('2026-11-08', value * 2000)], progress: [], perPage: 2000, today: '2026-11-08', timeZone: 'UTC' }).max;
  assert.deepEqual([0, 0.3, 1, 1.5, 3, 7, 12, 40].map(max), [1, 1, 1, 2, 5, 10, 20, 50]);
  assert.equal(buildBookChart({ days: [day('2026-11-08', null)], progress: [], perPage: 2000, today: '2026-11-08', timeZone: 'UTC' }).max, 1);
});

test('the journal lists sessions newest first, ten at a time, with re-reads and unavailable values told apart', () => {
  const sessions = [session(1), session(2, { characters: 0, volume_status: 'available' }), session(3, { characters: null, volume_status: 'unavailable', active_seconds: null, time_status: 'unavailable' }),
    session(4, { ended_at: null }), ...Array.from({ length: 10 }, (_, index) => session(5, { session_id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, started_at: `2026-10-${String(10 + index).padStart(2, '0')}T10:00:00Z` }))];
  const journal = buildJournal({ sessions, cycles: [], shown: 10, perPage: 2000, complete: true });
  assert.equal(journal.rows.length, 10);
  assert.equal(journal.total, 14);
  assert.equal(journal.remaining, 4);
  assert.equal(journal.hasMore, true);
  assert.equal(journal.rows[0].started, '4 Nov 2026, 10:00 UTC');                       // newest first
  const byDate = Object.fromEntries(buildJournal({ sessions: sessions.slice(0, 4), cycles: [], shown: 10, perPage: 2000, complete: true }).rows.map(row => [row.started.slice(0, 6), row]));
  assert.equal(byDate['4 Nov '].ongoing, true);
  assert.equal(byDate['4 Nov '].ended, null);
  assert.deepEqual([byDate['3 Nov '].pages, byDate['3 Nov '].time], [{ text: '—', state: 'unavailable' }, { text: '—', state: 'unavailable' }]);
  assert.deepEqual(byDate['2 Nov '].pages, { text: '0 new pages (re-read)', state: 'available' });
  assert.deepEqual(byDate['1 Nov '].time, { text: '25 min', state: 'available' });
  assert.equal(byDate['1 Nov '].ended, '1 Nov 2026, 10:30 UTC');
  const more = buildJournal({ sessions, cycles: [], shown: 20, perPage: 2000, complete: true });
  assert.equal(more.rows.length, 14);
  assert.equal(more.hasMore, false);
  assert.equal(more.truncated, false);
  assert.equal(buildJournal({ sessions, cycles: [], shown: 10, perPage: 2000, complete: false }).truncated, true);
});

test('sub-second timestamps and ties order sessions consistently and partial values keep their marker', () => {
  const a = session(1, { session_id: '00000000-0000-4000-8000-0000000000aa', started_at: '2026-11-01T10:00:00.5Z' });
  const b = session(1, { session_id: '00000000-0000-4000-8000-0000000000bb', started_at: '2026-11-01T10:00:00Z', volume_status: 'partial', time_status: 'partial', characters: 1000, active_seconds: 90 });
  const rows = buildJournal({ sessions: [b, a], cycles: [], shown: 10, perPage: 2000, complete: true }).rows;
  assert.deepEqual(rows.map(row => row.id), [a.session_id, b.session_id]);
  assert.deepEqual([rows[1].pages.text, rows[1].time.text, rows[1].pages.state], ['≥ 0.5 new pages', '≥ 1 min', 'partial']);
});

test('cycles are numbered from the explicit cycle events only and sessions name their cycle', () => {
  const cycles = [{ cycle_id: '20000000-0000-4000-8000-000000000002', source_id: SRC_B, started_at: '2026-11-03T00:00:00Z', finished_at: null },
    { cycle_id: '20000000-0000-4000-8000-000000000001', source_id: SRC_B, started_at: '2026-10-01T00:00:00Z', finished_at: '2026-10-20T12:00:00Z' }];
  const journal = buildJournal({ sessions: [session(4, { cycle_id: cycles[0].cycle_id }), session(2, { cycle_id: null }), session(1, { cycle_id: 'deadbeef-0000-4000-8000-000000000000' })], cycles, shown: 10, perPage: 2000, complete: true });
  assert.deepEqual(journal.cycles.map(cycle => [cycle.label, cycle.started, cycle.finished]), [['Cycle 1', '1 Oct 2026', '20 Oct 2026'], ['Cycle 2', '3 Nov 2026', null]]);
  assert.deepEqual(journal.rows.map(row => row.cycle), ['Cycle 2', '', '']);
  assert.deepEqual(buildJournal({ sessions: [], cycles: [], shown: 10, perPage: 2000, complete: true }).cycles, []);
});

test('an unfinished session with no new pages is not called a re-read yet', () => {
  const rows = buildJournal({ sessions: [session(4, { characters: 0, ended_at: null }), session(2, { characters: 0 })], cycles: [], shown: 10, perPage: 2000, complete: true }).rows;
  assert.deepEqual(rows.map(row => row.pages.text), ['0 new pages', '0 new pages (re-read)']);
});

test('a cut-off cycle list is not numbered as if it were complete', () => {
  const cycles = [{ cycle_id: '20000000-0000-4000-8000-000000000002', source_id: SRC_B, started_at: '2026-11-03T00:00:00Z', finished_at: null }];
  const journal = buildJournal({ sessions: [session(4, { cycle_id: cycles[0].cycle_id })], cycles, shown: 10, perPage: 2000, complete: true, cyclesComplete: false });
  assert.deepEqual(journal.cycles.map(cycle => cycle.label), ['Cycle']);
  assert.equal(journal.rows[0].cycle, 'Cycle');
  assert.equal(journal.cyclesComplete, false);
  assert.equal(buildJournal({ sessions: [], cycles, shown: 10, perPage: 2000, complete: true }).cyclesComplete, true);
});
