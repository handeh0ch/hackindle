// View model for the book page (#/books/<id>). Each source file keeps its own progress history,
// sessions and cycles; nothing is joined across sources. Unavailable stays "—", never zero.
import { UNAVAILABLE, formatPages, formatDuration, formatMetric, formatPercent, formatDate, formatInstant, todayIn } from '../lib/format.js';
import { coverUrl } from './books.js';

export const PERIOD_CHOICES = [30, 90, 365];

export function chooseSource(book, wanted) {
  const ids = book.sources.map(item => item.source_id);
  if (ids.includes(wanted)) return wanted;
  return ids.includes(book.most_recent_source_id) ? book.most_recent_source_id : ids[0];
}

export function sourceTabs(book, selectedId) {
  const total = new Map(), seen = new Map();
  for (const item of book.sources) total.set(item.format, (total.get(item.format) ?? 0) + 1);
  return book.sources.map(item => {
    seen.set(item.format, (seen.get(item.format) ?? 0) + 1);
    const name = item.format.toUpperCase();
    return { id: item.source_id, label: total.get(item.format) > 1 ? `${name} ${seen.get(item.format)}` : name,
      progress: formatPercent(item.progress?.fraction), selected: item.source_id === selectedId };
  });
}

// Sum of the measured days up to today. Days without a value make the sum a lower bound ("partial");
// no measured day at all is unavailable, not zero.
function totals(days, today, key, statusKey) {
  const elapsed = days.filter(item => item.date <= today);
  const measured = elapsed.filter(item => item[key] !== null);
  const status = measured.length === 0 ? 'unavailable'
    : measured.length < elapsed.length || measured.some(item => item[statusKey] === 'partial') ? 'partial' : 'available';
  return { value: status === 'unavailable' ? null : measured.reduce((sum, item) => sum + item[key], 0), status };
}

export function buildSummary({ days, perPage, today }) {
  const volume = totals(days, today, 'characters', 'volume_status'), time = totals(days, today, 'active_seconds', 'time_status');
  const active = days.filter(item => item.date <= today && ((item.characters ?? 0) > 0 || (item.active_seconds ?? 0) > 0)).length;
  const nothing = volume.status === 'unavailable' && time.status === 'unavailable';
  const incomplete = volume.status !== 'available' || time.status !== 'available';
  return {
    pages: formatMetric(volume.value, volume.status, characters => formatPages(characters, perPage)),
    minutes: formatMetric(time.value, time.status, formatDuration),
    activeDays: nothing ? { text: UNAVAILABLE, state: 'unavailable' } : { text: `${incomplete ? '≥ ' : ''}${active}`, state: incomplete ? 'partial' : 'available' },
  };
}

function niceMax(max) {
  if (!(max > 0)) return 1;
  const unit = 10 ** Math.floor(Math.log10(max)), n = max / unit;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * unit);
}

// Daily pages (bars) with the selected source's progress at the end of each day it was observed.
// Days without an observation have no progress point: nothing is carried forward or interpolated.
export function buildBookChart({ days, progress, perPage, today, timeZone }) {
  const latest = new Map();
  progress.map(item => ({ fraction: item.fraction, time: Date.parse(item.observed_at) })).filter(item => Number.isFinite(item.time))
    .sort((a, b) => a.time - b.time).forEach(item => latest.set(todayIn(timeZone, new Date(item.time)), item.fraction));
  const bars = days.map(item => {
    const value = item.date > today || item.characters === null ? null : item.characters / perPage;
    const state = value === null ? 'unavailable' : item.volume_status === 'partial' ? 'partial' : 'available';
    const fraction = latest.get(item.date) ?? null;
    const pagesText = value === null ? UNAVAILABLE : `${state === 'partial' ? '≥ ' : ''}${formatPages(item.characters, perPage)}`;
    return { date: item.date, value, state, fraction, percent: fraction === null ? null : Math.round(fraction * 1000) / 10, pagesText,
      label: `${formatDate(item.date)}: ${pagesText}${fraction === null ? '' : `, progress ${formatPercent(fraction)}`}` };
  });
  return { bars, max: niceMax(Math.max(0, ...bars.map(bar => bar.value ?? 0))), hasProgress: bars.some(bar => bar.percent !== null) };
}

// A measured zero is a re-read only once the session has ended; a running one may still read new text.
export function newPagesText(characters, status, perPage, ongoing = false) {
  if (characters === null || characters === undefined) return UNAVAILABLE;
  if (characters === 0) return status === 'partial' ? '≥ 0 new pages' : ongoing ? '0 new pages' : '0 new pages (re-read)';
  const pages = Math.round(characters / perPage * 10) / 10, prefix = status === 'partial' ? '≥ ' : '';
  return pages === 0 ? `${prefix}<0.1 new pages` : `${prefix}${pages} new ${pages === 1 ? 'page' : 'pages'}`;
}

const byStart = (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at);
const amountState = (value, status) => value === null ? 'unavailable' : status === 'partial' ? 'partial' : 'available';

// Sessions newest first (the server lists by id, so order is decided here), `shown` of them.
// Cycles are numbered only when the list is complete; a cut-off list would number them wrongly.
export function buildJournal({ sessions, cycles, shown, perPage, complete, cyclesComplete = true, timeZone = 'UTC' }) {
  const dateOf = iso => formatDate(todayIn(timeZone, new Date(iso)));
  const ordered = [...cycles].sort(byStart);
  const labels = new Map(ordered.map((item, index) => [item.cycle_id, cyclesComplete ? `Cycle ${index + 1}` : 'Cycle']));
  const rows = [...sessions].sort((a, b) => byStart(b, a) || (a.session_id < b.session_id ? 1 : -1)).map(item => ({
    id: item.session_id, started: formatInstant(item.started_at), ended: item.ended_at ? formatInstant(item.ended_at) : null, ongoing: item.ended_at === null,
    pages: { text: newPagesText(item.characters, item.volume_status, perPage, item.ended_at === null), state: amountState(item.characters, item.volume_status) },
    time: formatMetric(item.active_seconds, item.time_status, formatDuration), cycle: labels.get(item.cycle_id) ?? '',
  }));
  return {
    rows: rows.slice(0, shown), total: rows.length, remaining: Math.max(0, rows.length - shown), hasMore: rows.length > shown, truncated: !complete, cyclesComplete,
    cycles: ordered.map(item => ({ id: item.cycle_id, label: labels.get(item.cycle_id), started: dateOf(item.started_at), finished: item.finished_at ? dateOf(item.finished_at) : null })),
  };
}

export function buildBookPage({ book, sourceId, days, daily, progress, progressComplete, sessions, sessionsComplete, cycles, cyclesComplete = true, shown, perPage, today, timeZone }) {
  const selected = book.sources.find(item => item.source_id === sourceId) ?? book.sources[0];
  return {
    id: book.book_id, title: book.title, authors: book.authors.join(', '), formats: [...new Set(book.sources.map(item => item.format.toUpperCase()))],
    cover: { url: selected.cover_available ? coverUrl(selected.source_id) : null, initial: (book.title.trim()[0] ?? '?').toUpperCase() },
    activeDays: book.active_days, tracked: book.first_tracked_at ? `${formatInstant(book.first_tracked_at)} to ${formatInstant(book.last_tracked_at)}` : '',
    tabs: sourceTabs(book, selected.source_id),
    selected: { id: selected.source_id, format: selected.format.toUpperCase(), progress: formatPercent(selected.progress?.fraction),
      lastOpened: selected.last_opened_at ? formatInstant(selected.last_opened_at) : 'not opened yet' },
    days, summary: buildSummary({ days: daily, perPage, today }), progressComplete,
    chart: buildBookChart({ days: daily, progress, perPage, today, timeZone }),
    journal: buildJournal({ sessions, cycles, shown, perPage, complete: sessionsComplete, cyclesComplete, timeZone }),
  };
}
