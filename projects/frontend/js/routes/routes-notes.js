// Routes and actions for the notes list (#/notes) and one note (#/notes/<id>). The loaded list and the
// books catalog live in ctx.cache.notes; the chosen filters stay in ctx.noteFilters.
import { ApiError } from '../core/api.js';
import { isUuid } from '../lib/ids.js';
import { buildCatalog } from '../models/catalog.js';
import { DEFAULT_FILTERS, normalizeFilters, reconcileFilters, listQuery, buildNotes } from '../models/notes.js';
import { notesHtml, noteDetailHtml } from '../views/notes-view.js';
import { loadNote, buildNoteDetail } from '../models/note-detail.js';
import { guarded, errorText, missingHtml, flashHtml, setFlash, takeFlash } from '../core/flow.js';

async function loadCatalog(ctx) {
  const books = await ctx.api.pages('/owner/books', { limit: 100 }, 10);
  return buildCatalog(books.items, books.complete);
}

const filtersOf = ctx => (ctx.noteFilters ??= { ...DEFAULT_FILTERS });
const page = (ctx, cache, alert = '') => alert + notesHtml(buildNotes({ items: cache.items, next: cache.next, filters: filtersOf(ctx), catalog: cache.catalog }));

async function notes(ctx) {
  let cache = ctx.reuse ? ctx.cache.notes : null;
  if (!cache) {
    const catalog = await loadCatalog(ctx);
    ctx.noteFilters = reconcileFilters(filtersOf(ctx), catalog);   // a merged or reset book may be gone
    const firstPage = await ctx.api.get('/owner/annotations', listQuery(ctx.noteFilters));
    cache = ctx.cache.notes = { catalog, items: firstPage.items, next: firstPage.next_cursor };
  }
  return page(ctx, cache);
}

async function note(ctx, params) {
  const id = params[0], back = { href: '#/notes', text: 'Back to notes' };
  if (!isUuid(id)) return missingHtml('Note', 'This is not a valid note address.', back);
  let loaded;
  try { loaded = await loadNote(ctx.api, id); }
  catch (error) {
    if (error instanceof ApiError && error.status === 404) return missingHtml('Note not found', 'This note does not exist any more.', back);
    throw error;
  }
  // The catalog only adds the file name and a link to the book; without it the note is still shown.
  let catalog = null;   // always fresh: the list cache may predate a merge or split
  try { catalog = await loadCatalog(ctx); }
  catch (error) { if (error instanceof ApiError && error.status === 401) throw error; }
  return noteDetailHtml(buildNoteDetail({ ...loaded, catalog }));
}

export const noteParts = {
  routes: { notes, 'notes/id': note },
  actions: {
    'notes-archive'(ctx, value, { navigate }) {
      if (value !== 'active' && value !== 'archived') return undefined;
      filtersOf(ctx).archive = value;
      return navigate(ctx.hash, { focus: `[data-action="notes-archive"][data-value="${value}"]` });
    },
    async 'notes-more'(ctx, value, { navigate, render }) {
      const cache = ctx.cache.notes;
      if (!cache?.next || cache.loading) return undefined;
      cache.loading = true;
      const run = ctx.run;
      const result = await guarded(ctx, navigate, () => ctx.api.get('/owner/annotations', listQuery(filtersOf(ctx), cache.next)));
      cache.loading = false;
      if (result.handled) return undefined;
      if (!result.ok) {
        if (ctx.run !== run) return undefined;   // the owner moved on: do not draw over another page
        setFlash(ctx, 'alert', errorText('Could not load more notes', result.error));
        return render(page(ctx, cache, flashHtml(takeFlash(ctx))), '#flash');
      }
      cache.items.push(...result.value.items);
      cache.next = result.value.next_cursor;
      const firstNew = result.value.items[0]?.annotation_id;
      return navigate(ctx.hash, { quiet: true, focus: isUuid(firstNew) ? `a[href="#/notes/${firstNew}"]` : undefined });
    },
  },
  forms: {
    'notes-filter'(ctx, values, { navigate }) {
      ctx.noteFilters = normalizeFilters(values, ctx.cache.notes?.catalog ?? null, filtersOf(ctx));
      return navigate(ctx.hash);
    },
  },
};
