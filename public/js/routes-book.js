// Route handler and actions for the book page (#/books/<id>). Loaded parts are kept in ctx.cache.book
// per source and per period, so switching tabs only fetches what is missing.
import { ApiError } from './api.js';
import { addDays } from './format.js';
import { isUuid, isSourceId } from './ids.js';
import { buildCatalog } from './catalog.js';
import { PERIOD_CHOICES, chooseSource, buildBookPage } from './book.js';
import { bookHtml } from './book-view.js';
import { bookGroupingHtml } from './grouping.js';
import { flashHtml, takeFlash, needConfig, missingHtml } from './flow.js';

const listAll = (api, path, query, pages) => api.pages(path, { ...query, limit: 100 }, pages);
const BACK = { href: '#/books', text: 'Back to the library' };

function loadSource(api, id, sourceId) {
  return Promise.all([listAll(api, `/owner/sources/${encodeURIComponent(sourceId)}/progress`, {}, 20), listAll(api, '/owner/sessions', { book_id: id, source_id: sourceId }, 10),
    listAll(api, '/owner/cycles', { book_id: id, source_id: sourceId }, 5)]).then(([progress, sessions, cycles]) => ({ progress, sessions, cycles }));
}

async function bookRoute(ctx, params) {
  const id = params[0];
  if (!isUuid(id)) return missingHtml('Book', 'This is not a valid book address.', BACK);
  const config = await needConfig(ctx), today = ctx.today();
  const view = ctx.bookView = ctx.bookView?.bookId === id ? ctx.bookView : { bookId: id, sourceId: null, days: 30, shown: 10 };
  const cache = ctx.reuse && ctx.cache.book?.id === id ? ctx.cache.book : (ctx.cache.book = { id, bySource: {}, daily: {} });
  try { cache.book ??= await ctx.api.get(`/owner/books/${encodeURIComponent(id)}`); }
  catch (error) {
    if (error instanceof ApiError && error.status === 404) return missingHtml('Book not found', 'This book does not exist any more. It may have been merged into another book.', BACK);
    throw error;
  }
  const sourceId = view.sourceId = chooseSource(cache.book, view.sourceId);
  const jobs = [];
  if (!cache.bySource[sourceId]) jobs.push(loadSource(ctx.api, id, sourceId).then(data => { cache.bySource[sourceId] = data; }));
  if (!cache.daily[view.days]) jobs.push(ctx.api.get('/owner/statistics/daily', { from: addDays(today, 1 - view.days), to: today, book_id: id }).then(data => { cache.daily[view.days] = data.days; }));
  if (!cache.grouping) {
    jobs.push(Promise.all([listAll(ctx.api, '/owner/matches', {}, 5), listAll(ctx.api, '/owner/books', {}, 10)])
      .then(([matches, books]) => { cache.grouping = { matches: matches.items, catalog: buildCatalog(books.items, books.complete) }; }));
  }
  await Promise.all(jobs);
  const data = cache.bySource[sourceId];
  const model = buildBookPage({ book: cache.book, sourceId, days: view.days, daily: cache.daily[view.days], progress: data.progress.items, progressComplete: data.progress.complete,
    sessions: data.sessions.items, sessionsComplete: data.sessions.complete, cycles: data.cycles.items, cyclesComplete: data.cycles.complete, shown: view.shown, perPage: config.characters_per_page, today, timeZone: config.reporting_timezone ?? 'UTC' });
  return bookHtml(model, { layout: ctx.layout, grouping: bookGroupingHtml(cache.book, cache.grouping.matches, cache.grouping.catalog), flash: flashHtml(takeFlash(ctx)) });
}

export const bookParts = {
  routes: { 'books/id': bookRoute },
  actions: {
    'book-source'(ctx, value, { navigate }) {
      const view = ctx.bookView, book = ctx.cache.book?.book;
      if (!view || !book || !isSourceId(value) || !book.sources.some(item => item.source_id === value)) return undefined;
      view.sourceId = value;
      view.shown = 10;
      return navigate(ctx.hash, { quiet: true, focus: `[data-action="book-source"][data-value="${value}"]` });
    },
    'book-period'(ctx, value, { navigate }) {
      const days = Number(value);
      if (!ctx.bookView || !PERIOD_CHOICES.includes(days)) return undefined;
      ctx.bookView.days = days;
      return navigate(ctx.hash, { quiet: true, focus: `[data-action="book-period"][data-value="${days}"]` });
    },
    'journal-more'(ctx, value, { navigate }) {
      const view = ctx.bookView;
      if (!view) return undefined;
      view.shown += 10;
      const total = ctx.cache.book?.bySource[view.sourceId]?.sessions.items.length ?? 0;
      return navigate(ctx.hash, { quiet: true, focus: total > view.shown ? '[data-action="journal-more"]' : '#journal-title' });
    },
  },
};
