import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview, PERIODS } from '../../public/js/overview.js';

const config = { characters_per_page: 2000 };
const summary = (patch = {}) => ({ characters: 80000, active_seconds: 7200, conditional_pages: 40, legacy_native_pages: 0, legacy_native_seconds: 0,
  current_streak: 3, elapsed_days: 30, average_characters_per_day: 2666.6, average_seconds_per_day: 240, record_day: { date: '2026-11-02', characters: 9000, active_seconds: 1800, volume_status: 'available', time_status: 'available' },
  saved_words: 120, active_annotations: 14, volume_status: 'available', time_status: 'available', ...patch });
const day = (date, characters, seconds = 60, patch = {}) => ({ date, characters, active_seconds: seconds, volume_status: characters === null ? 'unavailable' : 'available', time_status: 'available', ...patch });
const days = Array.from({ length: 30 }, (_, index) => day(`2026-10-${String(index + 1).padStart(2, '0')}`, index * 100));
const vocabulary = { status: 'available', count: 120, items: [], next_cursor: null };
const goal = { year: 2026, target: 12, completed_unique_books: 3 };
const input = (patch = {}) => ({ config, summary: summary(), days, vocabulary, goal, period: 14, ...patch });

test('cards cover volume, time, streak, averages, record day, vocabulary, notes and goal', () => {
  const model = buildOverview(input());
  assert.equal(model.state, 'ready');
  assert.deepEqual(model.cards.map(card => card.id), ['volume', 'time', 'streak', 'average', 'record', 'vocabulary', 'annotations', 'goal']);
  const byId = Object.fromEntries(model.cards.map(card => [card.id, card]));
  assert.equal(byId.volume.value, '40 pages');
  assert.match(byId.volume.note, /conditional pages of 2000 characters/);
  assert.equal(byId.time.value, '2 h 00 min');
  assert.equal(byId.streak.value, '3 days');
  assert.equal(byId.average.value, '1.3 pages per day');
  assert.equal(byId.record.value, '4.5 pages');
  assert.equal(byId.record.note, '2 Nov 2026');
  assert.equal(byId.vocabulary.value, '120 words');
  assert.equal(byId.annotations.value, '14');
  assert.equal(byId.goal.value, '3 of 12 books');
  assert.equal(byId.goal.percent, 25);
});

test('no history is an empty state, not a row of zeros', () => {
  assert.equal(buildOverview(input({ summary: summary({ elapsed_days: 0 }) })).state, 'empty');
});

test('unavailable and partial values are never shown as zero', () => {
  const model = buildOverview(input({
    summary: summary({ characters: null, active_seconds: 5400, volume_status: 'unavailable', time_status: 'partial', record_day: null, average_characters_per_day: null, saved_words: null }),
    vocabulary: { status: 'unavailable', count: null, items: [], next_cursor: null },
  }));
  const byId = Object.fromEntries(model.cards.map(card => [card.id, card]));
  assert.deepEqual([byId.volume.value, byId.volume.state], ['—', 'unavailable']);
  assert.deepEqual([byId.time.value, byId.time.state], ['≥ 1 h 30 min', 'partial']);
  assert.equal(byId.average.value, '—');
  assert.equal(byId.record.value, '—');
  assert.deepEqual([byId.vocabulary.value, byId.vocabulary.state], ['—', 'unavailable']);
});

test('a partial volume status marks the daily average and chart labels too', () => {
  const model = buildOverview(input({ summary: summary({ volume_status: 'partial' }), days: days.map(entry => ({ ...entry, volume_status: 'partial' })), period: 7 }));
  const average = model.cards.find(card => card.id === 'average');
  assert.deepEqual([average.value, average.state], ['≥ 1.3 pages per day', 'partial']);
  assert.match(model.chart.bars.at(-2).label, /: ≥ 1\.4 pages$/);
});

test('an unset goal has no percentage and a completed goal caps the bar', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(buildOverview(input({ goal: { year: 2026, target: 0, completed_unique_books: 2 } })).cards.at(-1)).filter(([key]) => ['value', 'percent'].includes(key))),
    { value: 'No goal set', percent: null });
  assert.equal(buildOverview(input({ goal: { year: 2026, target: 2, completed_unique_books: 5 } })).cards.at(-1).percent, 100);
});

test('the chart shows the last 7, 14 or 30 days and keeps unavailable days as gaps', () => {
  assert.deepEqual(PERIODS, [7, 14, 30]);
  for (const period of PERIODS) assert.equal(buildOverview(input({ period })).chart.bars.length, period);
  assert.equal(buildOverview(input({ period: 99 })).chart.period, 14);
  const gap = days.map((entry, index) => index === 29 ? day(entry.date, null, null) : entry);
  const chart = buildOverview(input({ days: gap, period: 7 })).chart;
  assert.equal(chart.bars.at(-1).value, null);
  assert.equal(chart.bars.at(-1).state, 'unavailable');
  assert.equal(chart.bars.at(-2).value, 2800 / 2000);
  assert.equal(chart.max, 2800 / 2000);
  assert.equal(chart.bars[0].date, '2026-10-24');
  const partial = buildOverview(input({ days: days.map(entry => ({ ...entry, volume_status: 'partial' })), period: 7 })).chart;
  assert.equal(partial.bars[0].state, 'partial');
});

test('a chart with fewer days than the period uses what is available', () => {
  assert.equal(buildOverview(input({ days: days.slice(0, 3), period: 7 })).chart.bars.length, 3);
});
