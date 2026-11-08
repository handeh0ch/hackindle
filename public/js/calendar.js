// Yearly calendar model: Monday-first weeks, 365 or 366 real days, a level only for
// measured, non-future days. A day the API did not return is unavailable, not zero.
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekdayIndex = date => (date.getUTCDay() + 6) % 7;

export function buildYear({ year, days, metric, today }) {
  if (metric !== 'volume' && metric !== 'time') throw new Error('unknown calendar metric');
  const byDate = new Map(days.map(day => [day.date, day]));
  const cells = [];
  for (let time = Date.UTC(year, 0, 1); new Date(time).getUTCFullYear() === year; time += 86400000) {
    const moment = new Date(time);
    const date = moment.toISOString().slice(0, 10);
    const entry = byDate.get(date);
    const future = date > today;
    const value = future || !entry ? null : metric === 'volume' ? entry.characters : entry.active_seconds;
    const status = entry ? (metric === 'volume' ? entry.volume_status : entry.time_status) : 'unavailable';
    const state = future ? 'future' : value === null ? 'unavailable' : status === 'partial' ? 'partial' : 'available';
    cells.push({ date, weekday: WEEKDAYS[weekdayIndex(moment)], value, state, level: null, future });
  }
  const measured = cells.filter(cell => cell.value !== null).map(cell => cell.value);
  const max = measured.length ? Math.max(...measured) : 0;
  for (const cell of cells) if (cell.value !== null) cell.level = cell.value === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(4 * cell.value / max)));

  const lead = weekdayIndex(new Date(Date.UTC(year, 0, 1)));
  const padded = [...Array(lead).fill(null), ...cells];
  while (padded.length % 7) padded.push(null);
  const weeks = [];
  for (let start = 0; start < padded.length; start += 7) weeks.push(padded.slice(start, start + 7));
  const months = MONTHS.map((label, month) => {
    const first = cells.findIndex(cell => cell.date === new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10));
    return { label, week: Math.floor((lead + first) / 7) };
  });
  return { year, metric, max, weeks, months };
}
