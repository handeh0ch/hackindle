// View model for the grouped library (#/books). A card follows the most recently
// opened source; formats come from every grouped source.
import { formatPercent, formatInstant } from '../lib/format.js';

export const coverUrl = sourceId => `/api/v1/owner/sources/${encodeURIComponent(sourceId)}/cover`;

function cardFor(book) {
  const latest = book.sources.find(source => source.source_id === book.most_recent_source_id) ?? null;
  const withCover = (latest?.cover_available ? latest : null) ?? book.sources.find(source => source.cover_available) ?? null;
  const formats = [...new Set(book.sources.map(source => source.format.toUpperCase()))];
  const progress = latest?.progress
    ? { text: formatPercent(latest.progress.fraction), format: latest.format.toUpperCase(), state: 'available' }
    : { text: 'No progress recorded', format: null, state: 'unavailable' };
  return {
    id: book.book_id,
    href: `#/books/${book.book_id}`,
    title: book.title,
    authors: book.authors.join(', '),
    formats,
    progress,
    cover: { url: withCover ? coverUrl(withCover.source_id) : null, initial: (book.title.trim()[0] ?? '?').toUpperCase() },
    notes: { active: book.active_annotations, archived: book.archived_annotations },
    lastTracked: book.last_tracked_at ? formatInstant(book.last_tracked_at) : '',
  };
}

export function buildLibrary({ books, search, complete = true }) {
  const state = books.length ? 'ready' : search ? 'no_match' : 'empty';
  return { state, truncated: !complete, cards: books.map(cardFor) };
}
