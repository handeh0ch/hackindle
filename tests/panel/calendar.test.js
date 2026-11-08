import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYear } from '../../public/js/calendar.js';

const dayOf = (date, characters, seconds = 0, patch = {}) => ({ date, characters, active_seconds: seconds, volume_status: 'available', time_status: 'available', ...patch });
const cells = grid => grid.weeks.flat().filter(Boolean);

function fullYear(year, valueFor = () => 0) {
  const out = [];
  for (let time = Date.UTC(year, 0, 1); new Date(time).getUTCFullYear() === year; time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    out.push(dayOf(date, valueFor(date), valueFor(date) / 10));
  }
  return out;
}

test('a common year has 365 cells and a leap year 366 including 29 February', () => {
  assert.equal(cells(buildYear({ year: 2026, days: fullYear(2026), metric: 'volume', today: '2026-12-31' })).length, 365);
  const leap = buildYear({ year: 2024, days: fullYear(2024), metric: 'volume', today: '2024-12-31' });
  assert.equal(cells(leap).length, 366);
  assert.ok(cells(leap).some(cell => cell.date === '2024-02-29'));
});

test('weeks start on Monday and are padded at both ends', () => {
  const grid = buildYear({ year: 2026, days: fullYear(2026), metric: 'volume', today: '2026-12-31' });
  assert.ok(grid.weeks.every(week => week.length === 7));
  assert.deepEqual(grid.weeks[0].map(cell => cell?.date ?? null), [null, null, null, '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  assert.equal(grid.weeks[0][3].weekday, 'Thu');
  assert.equal(grid.weeks.at(-1).at(-1), null);   // 31 Dec 2026 is a Thursday
});

test('levels scale with the largest day; zero is level 0; unavailable and future days have no level', () => {
  const values = { '2026-01-02': 100, '2026-01-03': 50, '2026-01-04': 0, '2026-01-05': null };
  const input = fullYear(2026, date => values[date] ?? 0).map(entry => entry.date === '2026-01-05' ? dayOf(entry.date, null, null, { volume_status: 'unavailable', time_status: 'unavailable' }) : entry);
  const grid = buildYear({ year: 2026, days: input, metric: 'volume', today: '2026-06-30' });
  const byDate = Object.fromEntries(cells(grid).map(cell => [cell.date, cell]));
  assert.equal(byDate['2026-01-02'].level, 4);
  assert.equal(byDate['2026-01-03'].level, 2);
  assert.equal(byDate['2026-01-04'].level, 0);
  assert.deepEqual([byDate['2026-01-05'].level, byDate['2026-01-05'].state], [null, 'unavailable']);
  assert.deepEqual([byDate['2026-07-01'].future, byDate['2026-07-01'].level], [true, null]);
  assert.equal(byDate['2026-06-30'].future, false);
  assert.equal(grid.max, 100);
});

test('a day missing from the response is unavailable, never zero', () => {
  const grid = buildYear({ year: 2026, days: fullYear(2026).filter(entry => entry.date !== '2026-03-03'), metric: 'volume', today: '2026-12-31' });
  const missing = cells(grid).find(cell => cell.date === '2026-03-03');
  assert.deepEqual([missing.level, missing.value, missing.state], [null, null, 'unavailable']);
});

test('the time metric uses active seconds and partial days keep their level', () => {
  const input = [dayOf('2026-02-01', 1000, 600), dayOf('2026-02-02', 500, 1200, { time_status: 'partial' })];
  const grid = buildYear({ year: 2026, days: input, metric: 'time', today: '2026-12-31' });
  const byDate = Object.fromEntries(cells(grid).map(cell => [cell.date, cell]));
  assert.equal(byDate['2026-02-01'].value, 600);
  assert.equal(byDate['2026-02-02'].state, 'partial');
  assert.equal(byDate['2026-02-02'].level, 4);
  assert.equal(grid.metric, 'time');
  assert.throws(() => buildYear({ year: 2026, days: [], metric: 'bogus', today: '2026-12-31' }));
});

test('month labels point at the first week that contains the month start', () => {
  const grid = buildYear({ year: 2026, days: fullYear(2026), metric: 'volume', today: '2026-12-31' });
  assert.equal(grid.months.length, 12);
  assert.deepEqual(grid.months[0], { label: 'Jan', week: 0 });
  assert.equal(grid.months[1].label, 'Feb');
  assert.equal(grid.weeks[grid.months[1].week].some(cell => cell?.date === '2026-02-01'), true);
});
