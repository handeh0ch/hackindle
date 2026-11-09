// Route handlers: load data through the API, build view models, return HTML.
// Each handler receives the controller context (period, metric, search, today, api, cache).
// Period and metric changes re-render from ctx.cache instead of reloading (ctx.reuse).
import { addDays } from '../lib/format.js';
import { buildOverview } from '../models/overview.js';
import { buildYear } from '../models/calendar.js';
import { buildLibrary } from '../models/books.js';
import { overviewHtml, libraryHtml } from '../views/views.js';
import { bookParts } from './routes-book.js';
import { noteParts } from './routes-notes.js';
import { connectionParts } from './routes-connection.js';

async function loadOverview(ctx, year) {
  const today = ctx.today();
  const [config, summary, recent, yearly, vocabulary, goal] = await Promise.all([
    ctx.config ?? ctx.api.get('/owner/config'),
    ctx.api.get('/owner/statistics/summary'),
    ctx.api.get('/owner/statistics/daily', { from: addDays(today, -29), to: today }),
    ctx.api.get('/owner/statistics/daily', { from: `${year}-01-01`, to: `${year}-12-31` }),
    ctx.api.get('/owner/vocabulary', { limit: 1 }),
    ctx.api.get(`/owner/goals/${year}`),
  ]);
  return { today, year, config, summary, recent, yearly, vocabulary, goal };
}

async function overview(ctx) {
  const current = Number(ctx.today().slice(0, 4)), year = ctx.year ?? current;
  const cached = ctx.cache.overview;
  const loaded = ctx.reuse && cached && cached.year === year ? cached : (ctx.cache.overview = await loadOverview(ctx, year));
  const { today, config, summary, recent, yearly, vocabulary, goal } = loaded;
  const perPage = config.characters_per_page;
  const model = buildOverview({ config, summary, days: recent.days, vocabulary, goal, period: ctx.period });
  const calendar = buildYear({ year, days: yearly.days, metric: ctx.metric, today });
  return overviewHtml({ model, period: model.chart.period, metric: ctx.metric, year, calendar, perPage, canNext: year < current, layout: ctx.layout });
}

async function books(ctx) {
  const { items, complete } = await ctx.api.pages('/owner/books', { search: ctx.search || undefined, limit: 50 }, 4);
  return libraryHtml({ library: buildLibrary({ books: items, search: ctx.search, complete }), search: ctx.search });
}

export const defaultRoutes = { overview, books, ...bookParts.routes, ...noteParts.routes, ...connectionParts.routes };
export const defaultActions = { ...bookParts.actions, ...noteParts.actions, ...connectionParts.actions };
export const defaultForms = { ...noteParts.forms, ...connectionParts.forms };
