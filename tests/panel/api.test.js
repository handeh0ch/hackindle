import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../../projects/frontend/js/core/api.js';
import { load } from '../../projects/frontend/js/core/state.js';

function fakeFetch(handler) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body, credentials: init.credentials });
    const out = await handler(url, init, calls.length);
    if (out instanceof Error) throw out;
    return { status: out.status ?? 200, ok: (out.status ?? 200) < 400, json: async () => { if (out.badJson) throw new Error('x'); return out.body; }, text: async () => '' };
  };
  return { fetchFn, calls };
}

test('requests use same-origin relative paths and skip undefined parameters', async () => {
  const { fetchFn, calls } = fakeFetch(() => ({ body: { items: [], next_cursor: null } }));
  const api = createApi({ fetch: fetchFn });
  await api.get('/owner/books', { limit: 10, search: undefined, cursor: 'a b' });
  assert.equal(calls[0].url, '/api/v1/owner/books?limit=10&cursor=a+b');
  assert.equal(calls[0].credentials, 'same-origin');
  await api.get('/owner/books');
  assert.equal(calls[1].url, '/api/v1/owner/books');
  assert.ok(!calls.some(call => /^[a-z]+:\/\//.test(call.url)));
});

test('login and session store the CSRF token used by mutations only', async () => {
  const { fetchFn, calls } = fakeFetch((url, init, n) => {
    if (url.endsWith('/auth/login') || url.endsWith('/auth/session')) return { body: { owner: { username: 'o' }, csrf_token: 'tok', expires_at: 'x' } };
    return { status: 204 };
  });
  const api = createApi({ fetch: fetchFn });
  await assert.rejects(api.send('PUT', '/owner/goals/2026', { target: 3 }), error => error instanceof ApiError && error.code === 'no_session');
  const session = await api.login('owner', 'secret');
  assert.equal(session.owner.username, 'o');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].body), { username: 'owner', password: 'secret' });
  assert.equal(await api.send('PUT', '/owner/goals/2026', { target: 3 }), null);
  const put = calls.at(-1);
  assert.equal(put.headers['X-CSRF-Token'], 'tok');
  assert.equal(put.headers['Content-Type'], 'application/json');
  await api.get('/owner/books');
  assert.equal(calls.at(-1).headers['X-CSRF-Token'], undefined);
  await api.session();
  await api.logout();
  assert.equal(calls.at(-1).url, '/api/v1/auth/logout');
  await assert.rejects(api.send('POST', '/owner/reset', {}), error => error.code === 'no_session');
});

test('errors carry a stable code and never the response text', async () => {
  const cases = [
    [{ status: 401, body: { error: { code: 'unauthorized' } } }, 401, 'unauthorized'],
    [{ status: 409, body: { error: { code: 'content_changed' } } }, 409, 'content_changed'],
    [{ status: 500, body: {} }, 500, 'http_500'],
    [{ status: 502, badJson: true }, 502, 'http_502'],
  ];
  for (const [response, status, code] of cases) {
    const { fetchFn } = fakeFetch(() => response);
    await assert.rejects(createApi({ fetch: fetchFn }).get('/owner/books'), error => error.status === status && error.code === code);
  }
  const { fetchFn: down } = fakeFetch(() => new Error('offline'));
  await assert.rejects(createApi({ fetch: down }).get('/owner/books'), error => error.status === 0 && error.code === 'network');
  const { fetchFn: junk } = fakeFetch(() => ({ badJson: true }));
  await assert.rejects(createApi({ fetch: junk }).get('/owner/books'), error => error.code === 'invalid_response');
});

test('pages follows cursors and stops at the page limit', async () => {
  const { fetchFn, calls } = fakeFetch(url => {
    const cursor = new URL(url, 'http://x').searchParams.get('cursor');
    return { body: { items: [cursor ?? 'first'], next_cursor: cursor === 'c3' ? null : `c${(cursor ? Number(cursor.slice(1)) : 0) + 1}` } };
  });
  const api = createApi({ fetch: fetchFn });
  assert.deepEqual(await api.pages('/owner/books', {}, 10), { items: ['first', 'c1', 'c2', 'c3'], complete: true });
  const limited = await api.pages('/owner/books', {}, 2);
  assert.deepEqual(limited, { items: ['first', 'c1'], complete: false });
  assert.equal(calls.length, 6);
});

test('load reports loading, ready, unauthorized and error states', async () => {
  const seen = [];
  const record = state => seen.push(state.status);
  assert.deepEqual(await load(async () => 5, record), { status: 'ready', data: 5 });
  assert.deepEqual(seen, ['loading', 'ready']);
  assert.equal((await load(async () => { throw new ApiError(401, 'unauthorized'); }, record)).status, 'unauthorized');
  const failed = await load(async () => { throw new ApiError(500, 'http_500'); }, record);
  assert.deepEqual([failed.status, failed.error], ['error', 'http_500']);
  const odd = await load(async () => { throw new Error('boom'); }, () => {});
  assert.deepEqual([odd.status, odd.error], ['error', 'unexpected']);
});
