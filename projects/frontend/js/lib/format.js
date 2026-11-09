// Display formatting only. Values stay exact in the model; rounding happens here.
// Unavailable data is never rendered as a zero. Dates and instants are formatted
// from their ISO text in UTC/calendar terms, so the browser's timezone never matters.
export const UNAVAILABLE = '—';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = number => String(number).padStart(2, '0');

export function conditionalPages(characters, charactersPerPage) {
  return characters === null || characters === undefined ? null : characters / charactersPerPage;
}

export function formatPages(characters, charactersPerPage) {
  const pages = conditionalPages(characters, charactersPerPage);
  if (pages === null) return UNAVAILABLE;
  const rounded = Math.round(pages * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'page' : 'pages'}`;
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return UNAVAILABLE;
  if (seconds > 0 && seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
}

// status is the API's measurement status: available, partial (measured part only) or unavailable.
export function formatMetric(value, status, formatter) {
  if (value === null || value === undefined) return { text: UNAVAILABLE, state: 'unavailable' };
  const text = formatter(value);
  return status === 'partial' ? { text: `≥ ${text}`, state: 'partial' } : { text, state: status === 'unavailable' ? 'unavailable' : 'available' };
}

export function formatPercent(fraction) {
  return fraction === null || fraction === undefined ? UNAVAILABLE : `${Math.round(fraction * 100)}%`;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// The reporting date "now" in an IANA timezone (the instance's, not the browser's).
export function todayIn(timeZone, now) {
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  return formatter.format(now);
}

// Calendar-date arithmetic on ISO dates (YYYY-MM-DD), independent of the host timezone.
export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function formatDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate ?? '');
  if (!match) return UNAVAILABLE;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return UNAVAILABLE;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export function formatInstant(iso) {
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return UNAVAILABLE;
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
