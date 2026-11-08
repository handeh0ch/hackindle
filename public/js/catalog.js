// Lookup built from the books list: which file is in which book, with its name and format.
// `complete` is false when the list was cut off, so counts built from it are lower bounds.
export function buildCatalog(books, complete = true) {
  const sources = new Map();
  for (const entry of books) {
    for (const item of entry.sources) {
      sources.set(item.source_id, { sourceId: item.source_id, format: item.format.toUpperCase(), title: item.title || entry.title, bookId: entry.book_id, bookTitle: entry.title });
    }
  }
  return { complete, sources,
    books: books.map(entry => ({ id: entry.book_id, title: entry.title, active: entry.active_annotations, archived: entry.archived_annotations, sources: entry.sources.map(item => item.source_id) })) };
}

export function sourceName(catalog, sourceId) {
  const found = catalog?.sources.get(sourceId);
  return found ? `${found.title} · ${found.format}` : 'Unknown file';
}
