// Controller: hash routing, sign-in, resource states and user actions. It produces
// HTML through the injected `render(html, focusSelector)`, so it runs unchanged in a
// browser or a test. Only the newest navigation may render (slow loads are dropped).
import { ApiError } from './api.js';
import { load } from './state.js';
import { PERIODS } from './overview.js';
import { todayIn } from './format.js';
import { stateHtml, loginHtml } from './views.js';
import { defaultRoutes } from './routes.js';

const LOGIN_MESSAGES = { 401: 'Wrong username or password.', 429: 'Too many attempts. Wait a few minutes and try again.', 0: 'Could not reach the server.' };

export function createController({ api, render, today, now = () => new Date(), routes = {}, actions = {}, forms = {} }) {
  const table = { ...defaultRoutes, ...routes };
  const injected = typeof today === 'function';
  const ctx = { api, period: 14, metric: 'volume', search: '', hash: '#/overview', pending: '#/overview', config: null, cache: {}, reuse: false, run: 0, year: null, layout: 'halves',
    today: injected ? today : () => todayIn(ctx.config?.reporting_timezone ?? 'UTC', now()) };

  function resolve(hash) {
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const name = parts[0] ?? 'overview';
    const detail = `${name}/id`;
    const key = parts.length > 1 && Object.hasOwn(table, detail) ? detail : Object.hasOwn(table, name) ? name : 'overview';
    return { key, params: parts.slice(1), hash: key === 'overview' && !Object.hasOwn(table, name) ? '#/overview' : hash };
  }

  // quiet: re-render from data already loaded (no loading flash, no refetch); focus: control to refocus.
  async function navigate(hash = '#/overview', { quiet = false, focus } = {}) {
    const route = resolve(hash);
    const run = ++ctx.run;
    ctx.hash = route.hash;
    ctx.reuse = quiet;
    const result = await load(async () => {
      if (!injected && !ctx.config) ctx.config = await api.get('/owner/config');
      return table[route.key](ctx, route.params);
    }, state => { if (state.status === 'loading' && !quiet) render(stateHtml('loading')); });
    ctx.reuse = false;
    if (run !== ctx.run) return;
    if (result.status === 'ready') render(result.data, focus);
    else if (result.status === 'unauthorized') showLogin('');
    else render(stateHtml('error', result.error));
  }

  function showLogin(message) {
    ctx.pending = ctx.hash;
    ctx.cache = {};
    render(loginHtml(message));
  }

  return {
    ctx,
    navigate,
    async start(hash) {
      ctx.hash = hash || '#/overview';
      try { await api.session(); }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) return showLogin('');
        return render(stateHtml('error', error instanceof ApiError ? error.code : 'unexpected'));
      }
      return navigate(ctx.hash);
    },
    async action(name, value) {
      if (name === 'retry') return navigate(ctx.hash);
      if (name === 'period') {
        if (PERIODS.includes(Number(value))) ctx.period = Number(value);
        return navigate(ctx.hash, { quiet: true, focus: `[data-period="${ctx.period}"]` });
      }
      if (name === 'metric') {
        if (value === 'volume' || value === 'time') ctx.metric = value;
        return navigate(ctx.hash, { quiet: true, focus: `[data-metric="${ctx.metric}"]` });
      }
      if (name === 'year') {
        const current = Number(ctx.today().slice(0, 4)), next = (ctx.year ?? current) + Number(value);
        if (!Number.isInteger(next) || next > current || next < current - 20) return undefined;
        ctx.year = next;
        return navigate(ctx.hash, { focus: `[data-action="year"][data-value="${value}"]` });
      }
      if (name === 'layout') {
        ctx.layout = value === 'single' ? 'single' : 'halves';
        return navigate(ctx.hash, { quiet: true });
      }
      if (name === 'logout') {
        try { await api.logout(); }
        catch (error) { return render(stateHtml('alert', `Could not sign out (${error instanceof ApiError ? error.code : 'unexpected'}). Try again.`)); }
        return showLogin('');
      }
      if (actions[name]) return actions[name](ctx, value, { navigate, render });
      return undefined;
    },
    async submit(name, values) {
      if (name === 'login') {
        try { await api.login(values.username, values.password); }
        catch (error) {
          const code = error instanceof ApiError ? error.status : -1;
          return showLogin(LOGIN_MESSAGES[code] ?? `Sign-in failed (${error instanceof ApiError ? error.code : 'unexpected'}).`);
        }
        return navigate(ctx.pending);
      }
      if (name === 'search') { ctx.search = String(values.q ?? '').trim(); return navigate(ctx.hash); }
      if (forms[name]) return forms[name](ctx, values, { navigate, render });
      return undefined;
    },
  };
}
