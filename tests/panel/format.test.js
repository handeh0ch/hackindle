import test from 'node:test';
import assert from 'node:assert/strict';
import { UNAVAILABLE, conditionalPages, formatPages, formatDuration, formatMetric, formatPercent, formatDate, formatInstant, isLeapYear, todayIn } from '../../projects/frontend/js/lib/format.js';

test('conditional pages keep exact values and never turn null into zero', () => {
  assert.equal(conditionalPages(4000, 2000), 2);
  assert.equal(conditionalPages(null, 2000), null);
  assert.equal(formatPages(5000, 2000), '2.5 pages');
  assert.equal(formatPages(2000, 2000), '1 page');
  assert.equal(formatPages(0, 2000), '0 pages');   // a measured zero is a real value
  assert.equal(formatPages(null, 2000), UNAVAILABLE);
});

test('durations are shown in seconds, minutes or hours', () => {
  assert.equal(formatDuration(null), UNAVAILABLE);
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(600), '10 min');
  assert.equal(formatDuration(3600), '1 h 00 min');
  assert.equal(formatDuration(3725), '1 h 02 min');
});

test('metrics distinguish available, partial and unavailable', () => {
  const pages = value => formatPages(value, 2000);
  assert.deepEqual(formatMetric(4000, 'available', pages), { text: '2 pages', state: 'available' });
  assert.deepEqual(formatMetric(4000, 'partial', pages), { text: '≥ 2 pages', state: 'partial' });
  assert.deepEqual(formatMetric(null, 'unavailable', pages), { text: UNAVAILABLE, state: 'unavailable' });
  assert.deepEqual(formatMetric(null, 'partial', pages), { text: UNAVAILABLE, state: 'unavailable' });
});

test('percent, dates and instants do not depend on the host timezone', () => {
  assert.equal(formatPercent(0.4567), '46%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(null), UNAVAILABLE);
  assert.equal(formatDate('2026-11-08'), '8 Nov 2026');
  assert.equal(formatDate('2024-02-29'), '29 Feb 2024');
  assert.equal(formatDate('nonsense'), UNAVAILABLE);
  assert.equal(formatDate(null), UNAVAILABLE);
  assert.equal(formatInstant('2026-11-08T20:26:05.123Z'), '8 Nov 2026, 20:26 UTC');
  assert.equal(formatInstant(null), UNAVAILABLE);
  assert.equal(formatInstant('bad'), UNAVAILABLE);
});

test('today is computed in the reporting timezone, not the browser timezone', () => {
  const now = new Date('2026-11-08T20:00:00Z');
  assert.equal(todayIn('UTC', now), '2026-11-08');
  assert.equal(todayIn('Asia/Tokyo', now), '2026-11-09');
  assert.equal(todayIn('America/Los_Angeles', now), '2026-11-08');
  assert.equal(todayIn('Not/AZone', now), '2026-11-08');   // an invalid zone falls back to UTC
});

test('leap years follow the Gregorian rule', () => {
  assert.deepEqual([2024, 2026, 1900, 2000].map(isLeapYear), [true, false, false, true]);
});
