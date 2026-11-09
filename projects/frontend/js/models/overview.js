// View model for #/overview. Exact API values go in, display text comes out;
// null stays unavailable and is never rendered as zero.
import { UNAVAILABLE, formatPages, formatDuration, formatMetric, formatDate } from '../lib/format.js';

export const PERIODS = [7, 14, 30];
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function goalCard(goal) {
  if (!goal.target) return { id: 'goal', label: `Reading goal ${goal.year}`, value: 'No goal set', state: 'available', percent: null, note: '' };
  return { id: 'goal', label: `Reading goal ${goal.year}`, value: `${goal.completed_unique_books} of ${plural(goal.target, 'book', 'books')}`,
    state: 'available', percent: Math.min(100, Math.round(goal.completed_unique_books / goal.target * 100)), note: 'Unique books finished this year' };
}

function chartFor(days, period, perPage) {
  const chosen = PERIODS.includes(period) ? period : 14;
  const bars = days.slice(-chosen).map(day => {
    const value = day.characters === null ? null : day.characters / perPage;
    const state = value === null ? 'unavailable' : day.volume_status === 'partial' ? 'partial' : 'available';
    return { date: day.date, value, state, label: `${formatDate(day.date)}: ${value === null ? UNAVAILABLE : `${state === 'partial' ? '≥ ' : ''}${formatPages(day.characters, perPage)}`}` };
  });
  const values = bars.map(bar => bar.value).filter(value => value !== null);
  return { period: chosen, unit: 'conditional pages', bars, max: values.length ? Math.max(...values) : 0 };
}

export function buildOverview({ config, summary, days, vocabulary, goal, period }) {
  const perPage = config.characters_per_page;
  if (summary.elapsed_days === 0) return { state: 'empty', cards: [], chart: chartFor([], period, perPage) };
  const volume = formatMetric(summary.characters, summary.volume_status, characters => formatPages(characters, perPage));
  const time = formatMetric(summary.active_seconds, summary.time_status, formatDuration);
  const average = summary.average_characters_per_day === null
    ? { text: UNAVAILABLE, state: 'unavailable' }
    : formatMetric(summary.average_characters_per_day, summary.volume_status, characters => `${formatPages(characters, perPage)} per day`);
  const words = vocabulary.status === 'available' && vocabulary.count !== null
    ? { text: plural(vocabulary.count, 'word', 'words'), state: 'available' }
    : { text: UNAVAILABLE, state: 'unavailable' };
  const record = summary.record_day;
  return {
    state: 'ready',
    cards: [
      { id: 'volume', label: 'Reading volume', value: volume.text, state: volume.state, note: `conditional pages of ${perPage} characters` },
      { id: 'time', label: 'Active reading time', value: time.text, state: time.state, note: 'KOReader active time' },
      { id: 'streak', label: 'Current streak', value: plural(summary.current_streak, 'day', 'days'), state: 'available', note: 'Counts today or yesterday' },
      { id: 'average', label: 'Daily average', value: average.text, state: average.state, note: `over ${plural(summary.elapsed_days, 'elapsed day', 'elapsed days')}` },
      { id: 'record', label: 'Record day', value: record ? formatPages(record.characters, perPage) : UNAVAILABLE, state: record ? 'available' : 'unavailable', note: record ? formatDate(record.date) : '' },
      { id: 'vocabulary', label: 'Saved words', value: words.text, state: words.state, note: 'Unique words in Vocabulary Builder' },
      { id: 'annotations', label: 'Active notes', value: String(summary.active_annotations), state: 'available', note: 'Highlights and bookmarks' },
      goalCard(goal),
    ],
    chart: chartFor(days, period, perPage),
  };
}
