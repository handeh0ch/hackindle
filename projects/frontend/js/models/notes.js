// View model for the notes list (#/notes): filters, counts and list rows. Counts are totals for the
// chosen book (or all books); the API has no per-file or per-search count, so those are not invented.
import { sourceName } from './catalog.js';

export const DEFAULT_FILTERS = { search: '', book: '', source: '', archive: 'active' };

export function normalizeFilters(values, catalog, previous) {
  const book = catalog?.books.some(item => item.id === values.book) ? values.book : '';
  let source = catalog?.sources.has(values.source) ? values.source : '';
  if (source && book && catalog.sources.get(source).bookId !== book) source = '';
  return { search: String(values.q ?? '').trim().slice(0, 200), book, source, archive: previous.archive };
}

// Drops a book or file that is not in the freshly loaded catalog (merge or reset can remove them).
export const reconcileFilters = (filters, catalog) => normalizeFilters({ q: filters.search, book: filters.book, source: filters.source }, catalog, filters);

export function listQuery(filters, cursor) {
  const query = { archive: filters.archive, limit: 50 };
  if (filters.search) query.search = filters.search;
  if (filters.book) query.book_id = filters.book;
  if (filters.source) query.source_id = filters.source;
  if (cursor) query.cursor = cursor;
  return query;
}

export function noteCounts(catalog, filters) {
  const unknown = { active: null, archived: null, approximate: false };
  if (!catalog || filters.source) return unknown;
  if (filters.book) {
    const entry = catalog.books.find(item => item.id === filters.book);
    return entry ? { active: entry.active, archived: entry.archived, approximate: false } : unknown;
  }
  return { active: catalog.books.reduce((sum, item) => sum + item.active, 0), archived: catalog.books.reduce((sum, item) => sum + item.archived, 0), approximate: !catalog.complete };
}

const CONTEXT_TEXT = { ready: 'Context: ready', pending: 'Context: pending', unavailable: 'Context: unavailable', none: 'Context: none' };
const contextText = item => item.context_status === 'none' && item.kind === 'bookmark' ? 'No context (bookmark)' : CONTEXT_TEXT[item.context_status];

export function buildNotes({ items, next, filters, catalog }) {
  // The counts are library totals, not search matches: say so while a search is active.
  const counts = noteCounts(catalog, filters), scope = filters.search ? ' in library' : '';
  const shown = value => value === null ? '' : ` (${counts.approximate ? '≥ ' : ''}${value}${scope})`;
  const rows = items.map(item => ({ id: item.annotation_id, href: `#/notes/${item.annotation_id}`, kind: item.kind === 'bookmark' ? 'Bookmark' : 'Highlight', archived: item.archived,
    quote: item.quote_preview, note: item.note_preview, context: contextText(item), source: sourceName(catalog, item.source_id) }));
  const books = [...(catalog?.books ?? [])].sort((a, b) => a.title.localeCompare(b.title)).map(item => ({ id: item.id, label: item.title, selected: item.id === filters.book }));
  const files = [...(catalog?.sources.values() ?? [])].filter(item => !filters.book || item.bookId === filters.book)
    .map(item => ({ id: item.sourceId, label: sourceName(catalog, item.sourceId), selected: item.sourceId === filters.source })).sort((a, b) => a.label.localeCompare(b.label));
  return {
    filters, rows, more: Boolean(next), books, files,
    state: rows.length ? 'ready' : filters.search ? 'no_match' : filters.archive === 'archived' ? 'empty_archive' : 'empty',
    heading: counts.active === null ? null : `${counts.approximate ? '≥ ' : ''}${counts.active} active${scope}`,
    tabs: [{ value: 'active', label: `Active${shown(counts.active)}`, pressed: filters.archive === 'active' }, { value: 'archived', label: `Archived${shown(counts.archived)}`, pressed: filters.archive === 'archived' }],
  };
}
