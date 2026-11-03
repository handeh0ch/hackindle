import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../../server/reports.js';
import { validate } from '../../contracts/validate.js';
test('reports include elapsed zero days, unknown measurements, future days and independent legacy totals', () => {
  const rows = [
    { date: '2024-02-28', characters: 4000, active_seconds: 120, volume_measured: 1, volume_unknown: 0, time_measured: 1, time_unknown: 0 },
    { date: '2024-02-29', characters: 0, active_seconds: 60, volume_measured: 1, volume_unknown: 1, time_measured: 1, time_unknown: 0 },
  ];
  const result = summarize({ rows, today: '2024-03-01', from: '2024-02-28', to: '2024-03-02', earliest: '2024-02-28', denominator: 2000, legacy_pages: 50, legacy_seconds: 30, words: 2, annotations: 1, daily: true });
  assert.equal(validate('daily', result), true); assert.equal(result.days.length, 4);
  assert.equal(result.days[1].volume_status, 'partial'); assert.equal(result.days[2].characters, 0); assert.equal(result.days[3].characters, null);
  assert.equal(result.summary.conditional_pages, 2); assert.equal(result.summary.elapsed_days, 3); assert.equal(result.summary.average_characters_per_day, 4000 / 3);
  assert.equal(result.summary.current_streak, 2); assert.equal(result.summary.record_day.date, '2024-02-28'); assert.equal(result.summary.legacy_native_pages, 50);
});
test('reports retain unavailable as null and use no fabricated average when period is future', () => {
  const input = { rows: [{ date: '2024-02-29', characters: null, active_seconds: null, volume_measured: 0, volume_unknown: 1, time_measured: 0, time_unknown: 1 }], today: '2024-02-29', earliest: '2024-02-29', denominator: 2000, legacy_pages: 0, legacy_seconds: 0, words: null, annotations: 0 };
  const current = summarize({ ...input, from: '2024-02-29', to: '2024-02-29' });
  assert.equal(validate('summary', current), true); assert.equal(current.characters, null); assert.equal(current.volume_status, 'unavailable');
  const future = summarize({ ...input, from: '2024-03-01', to: '2024-03-03' });
  assert.equal(future.elapsed_days, 0); assert.equal(future.average_characters_per_day, null);
});

test('statistics endpoint validates date bounds and uses scoped aggregate results', async () => {
  const { statistics } = await import('../../server/reports.js');
  const db = { withTransaction: async work => work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ reporting_timezone: 'UTC', page_characters: '2000', today: '2024-03-01' }] };
    if (sql.startsWith('WITH scoped')) return { rows: [{ date: '2024-02-29', characters: '4000', active_seconds: '60', volume_measured: '1', volume_unknown: '0', time_measured: '1', time_unknown: '0' }] };
    if (sql.startsWith('SELECT min(')) return { rows: [{ earliest: '2024-02-29' }] };
    if (sql.startsWith('SELECT COALESCE')) return { rows: [{ legacy_pages: '10', legacy_seconds: '20', annotations: '1' }] };
    if (sql.startsWith('SELECT v.device_id')) return { rows: [] };
    throw new Error(`Unexpected query ${sql}`);
  } }) };
  const result = await statistics(db, { from: '2024-02-28', to: '2024-03-01' }, true);
  assert.equal(validate('daily', result), true); assert.equal(result.summary.conditional_pages, 2); assert.equal(result.summary.saved_words, null);
  await assert.rejects(statistics(db, { from: '2024-03-02', to: '2024-03-01' }, true), e => e.status === 400);
  await assert.rejects(statistics(db, { from: '2023-01-01', to: '2024-12-31' }, true), e => e.status === 400);
});

test('report totals reject unsafe integer sums rather than returning rounded values', () => {
  const row = value => ({ date: '2024-02-29', characters: value, active_seconds: '0', volume_measured: 1, volume_unknown: 0, time_measured: 1, time_unknown: 0 });
  assert.throws(() => summarize({ rows: [row('9007199254740991'), { ...row('1'), date: '2024-03-01' }], today: '2024-03-01', earliest: '2024-02-29', denominator: 2000, legacy_pages: 0, legacy_seconds: 0, words: 0, annotations: 0 }), e => e.code === 'totals_overflow');
});
