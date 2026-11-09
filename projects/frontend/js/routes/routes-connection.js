// Route and forms for #/connection: device, yearly goal, grouping and reset. Results are shown as a
// one-shot flash on the reloaded page. A new device token is rendered straight from the response and
// is never stored in ctx or the cache, so any later render drops it.
import { buildCatalog } from '../models/catalog.js';
import { buildConnection, parseTarget } from '../models/connection.js';
import { connectionHtml, tokenBoxHtml } from '../views/connection-view.js';
import { buildMatches, groupingSection, groupingActions } from './grouping.js';
import { flashHtml, takeFlash, setFlash, guarded, errorText, gateOpen } from '../core/flow.js';

const yearOf = ctx => Number(ctx.today().slice(0, 4));

function pageHtml(ctx, cache, extras = {}) {
  return connectionHtml(buildConnection({ device: cache.device, goal: cache.goal }),
    { ...extras, flash: flashHtml(takeFlash(ctx)), grouping: groupingSection(buildMatches({ matches: cache.matches, catalog: cache.catalog })) });
}

async function connection(ctx) {
  let cache = ctx.reuse ? ctx.cache.connection : null;
  if (!cache) {
    const [device, goal, matches, books] = await Promise.all([ctx.api.get('/owner/device'), ctx.api.get(`/owner/goals/${yearOf(ctx)}`),
      ctx.api.pages('/owner/matches', { limit: 100 }, 5), ctx.api.pages('/owner/books', { limit: 100 }, 10)]);
    cache = ctx.cache.connection = { device, goal, matches: matches.items, catalog: buildCatalog(books.items, books.complete) };
  }
  return pageHtml(ctx, cache);
}

// Runs a mutation that reloads the page and says what happened.
async function mutate(ctx, navigate, request, { done, failed }) {
  const result = await guarded(ctx, navigate, request);
  if (result.handled) return undefined;
  if (result.ok) setFlash(ctx, 'status', done(result.value));
  else setFlash(ctx, 'alert', errorText(failed, result.error));
  return navigate(ctx.hash, { focus: '#flash' });
}

export const connectionParts = {
  routes: { connection },
  actions: { ...groupingActions.actions },
  forms: {
    ...groupingActions.forms,
    async 'device-rotate'(ctx, values, { navigate, render }) {
      if (!gateOpen('ack', values)) return undefined;
      const run = ctx.run;
      const result = await guarded(ctx, navigate, () => ctx.api.send('POST', '/owner/device/token', {}));
      if (result.handled) return undefined;
      if (!result.ok) {
        setFlash(ctx, 'alert', errorText('Could not rotate the token', result.error, { network: 'No answer was received, so the token may already have been rotated. Check on this page that the Kindle can still sync before rotating again' }));
        return navigate(ctx.hash, { focus: '#flash' });
      }
      if (ctx.run !== run) return undefined;   // the owner moved on: do not draw the secret over another page
      const cache = ctx.cache.connection, token = result.value.device_token;
      return render(cache ? pageHtml(ctx, cache, { token }) : `<h2>Connection</h2>${tokenBoxHtml(token)}`, '#new-token');
    },
    'device-unbind'(ctx, values, { navigate }) {
      if (!gateOpen('ack', values)) return undefined;
      return mutate(ctx, navigate, () => ctx.api.send('POST', '/owner/device/unbind', {}),
        { failed: 'Could not unbind the device', done: () => 'Device unbound. A replacement installation can now bind with the current token.' });
    },
    async 'goal-save'(ctx, values, { navigate }) {
      const target = parseTarget(values.target), year = yearOf(ctx);
      if (target === null) { setFlash(ctx, 'alert', 'Enter the goal as a whole number, 0 or more.'); return navigate(ctx.hash, { focus: '#flash' }); }
      return mutate(ctx, navigate, () => ctx.api.send('PUT', `/owner/goals/${year}`, { target }),
        { failed: 'Could not save the goal', done: () => `Goal for ${year} saved: ${target === 0 ? 'no goal' : `${target} ${target === 1 ? 'book' : 'books'}`}.` });
    },
    reset(ctx, values, { navigate }) {
      if (!gateOpen('reset', values)) return undefined;
      return mutate(ctx, navigate, () => ctx.api.send('POST', '/owner/reset', { confirm: 'reset' }), { failed: 'Could not reset the data',
        done: result => `All synced reading data and notes were deleted. Reset generation is now ${result.reset_generation}. Unsent data on the device will be discarded.` });
    },
  },
};
