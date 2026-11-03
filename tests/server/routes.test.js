import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
async function dispatch(app, method, path, headers = {}, body = '') {
  const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } }); socket.remoteAddress = '127.0.0.1';
  const req = new IncomingMessage(socket); req.method = method; req.url = path; req.headers = headers;
  const res = new ServerResponse(req); res.assignSocket(socket); let done; const finished = new Promise(resolve => { done = resolve; });
  const end = res.end; res.end = function (...args) { res.raw = String(args[0] ?? ''); const result = end.apply(this, args); done(); return result; };
  app.handle(req, res); req.push(body); req.push(null); await finished; return res;
}
test('sync and upload routes reject unauthenticated callers before writes', async () => {
  const db = { withTransaction: async () => { throw new Error('must not write'); } };
  const config = loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' });
  const app = createApp({ db, config });
  assert.equal((await dispatch(app, 'POST', '/api/v1/sync', { 'content-type': 'application/json', 'content-length': '2' }, '{}')).statusCode, 401);
  assert.equal((await dispatch(app, 'POST', '/api/v1/uploads', { 'content-type': 'application/json', 'content-length': '2' }, '{}')).statusCode, 401);
});
import { createHash } from 'node:crypto';
import { csrfFor } from '../../server/auth.js';
test('B2 routes enforce input validation and expose only owner-authorized detail and cover', async () => {
  const annotationId = '48bc0344-efad-4c68-adb6-dc0f0ba57276', source = 'a'.repeat(64), csrf = csrfFor('session');
  const db = { query: async sql => {
    if (sql.startsWith('SELECT username, csrf_hash')) return { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] };
    if (sql.startsWith('SELECT annotation_id')) return { rows: [{ annotation_id: annotationId, source_id: source, version: 1, archived: false, content: { kind: 'highlight', quote: 'Synthetic', note: '', context: { status: 'pending', reason: 'synthetic' } } }] };
    if (sql.startsWith('SELECT cover,')) return { rows: [{ cover: Buffer.from([255,216,255,217]), cover_type: 'image/jpeg' }] };
    if (sql.startsWith('SELECT instance.reset_generation')) return { rows: [{ reset_generation: 0, device_id: null, last_sync_at: null }] };
    return { rows: [] };
  }, withTransaction: async fn => fn({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ instance_id: annotationId, reset_generation: 0 }] } : { rows: [] } }) };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  const jsonHeaders = { authorization: 'Bearer token', 'content-type': 'application/json', 'content-length': '2' };
  assert.equal((await dispatch(app, 'POST', '/api/v1/sync', jsonHeaders, '{}')).statusCode, 400);
  assert.equal((await dispatch(app, 'POST', '/api/v1/uploads', jsonHeaders, '{}')).statusCode, 400);
  assert.equal((await dispatch(app, 'POST', '/api/v1/uploads/bad/commit', { authorization: 'Bearer token' })).statusCode, 400);
  assert.equal((await dispatch(app, 'PUT', `/api/v1/uploads/${annotationId}/chunks/not-number`, { authorization: 'Bearer token', 'content-type': 'application/octet-stream', 'content-length': '1' }, 'x')).statusCode, 400);
  assert.equal((await dispatch(app, 'PUT', `/api/v1/sources/${source}/cover`, { authorization: 'Bearer token', 'content-type': 'image/jpeg', 'content-length': '1' }, 'x')).statusCode, 400);
  const owner = { cookie: 'kindle_sync_session=session' };
  assert.equal((await dispatch(app, 'GET', `/api/v1/owner/annotations/${annotationId}`, owner)).statusCode, 200);
  assert.equal((await dispatch(app, 'GET', `/api/v1/owner/annotations/${annotationId}/content?field=quote`, owner)).statusCode, 200);
  const cover = await dispatch(app, 'GET', `/api/v1/owner/sources/${source}/cover`, owner); assert.equal(cover.statusCode, 200); assert.equal(cover.getHeader('X-Content-Type-Options'), 'nosniff');
  assert.equal((await dispatch(app, 'GET', '/api/v1/owner/device', owner)).statusCode, 200);
  const resetHeaders = { ...owner, origin: 'https://example.invalid', 'x-csrf-token': csrf, 'content-type': 'application/json', 'content-length': '19' };
  assert.equal((await dispatch(app, 'POST', '/api/v1/owner/reset', resetHeaders, '{"confirm":"reset"}')).statusCode, 200);
});

test('goal route accepts an authenticated owner and requires CSRF for changes', async () => {
  const csrf = csrfFor('session'); let target = 0, locked = false;
  const db = { query: async (sql, args) => {
    if (sql.startsWith('SELECT username, csrf_hash')) return { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] };
    if (sql.startsWith('SELECT instance_id')) { locked = true; return { rows: [{ reset_generation: 0 }] }; }
    if (sql.startsWith('INSERT INTO goals')) { assert.equal(locked, true); target = args[1]; return { rows: [] }; }
    return { rows: [{ target, completed_unique_books: '2' }] };
  }, withTransaction: async work => { locked = false; return work(db); } };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  const owner = { cookie: 'kindle_sync_session=session' };
  const goal = await dispatch(app, 'GET', '/api/v1/owner/goals/2024', owner);
  assert.equal(goal.statusCode, 200); assert.match(goal.raw, /"year":2024,"target":0,"completed_unique_books":2/);
  assert.equal((await dispatch(app, 'GET', '/api/v1/owner/goals/0000', owner)).statusCode, 400);
  assert.equal((await dispatch(app, 'PUT', '/api/v1/owner/goals/2024', { ...owner, 'content-type': 'application/json', 'content-length': '12' }, '{"target":3}')).statusCode, 403);
  const authorized = { ...owner, origin: 'https://example.invalid', 'x-csrf-token': csrf, 'content-type': 'application/json', 'content-length': '12' };
  const updated = await dispatch(app, 'PUT', '/api/v1/owner/goals/2024', authorized, '{"target":3}');
  assert.equal(updated.statusCode, 200); assert.match(updated.raw, /"year":2024,"target":3,"completed_unique_books":2/);
  assert.equal((await dispatch(app, 'PUT', '/api/v1/owner/goals/2024', { ...authorized, 'content-length': '13' }, '{"target":-1}')).statusCode, 400);
});

test('vocabulary reports unavailable before the first successful snapshot', async () => {
  const csrf = csrfFor('session');
  const db = { query: async sql => sql.startsWith('SELECT username, csrf_hash') ? { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] } : { rows: [] },
    withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ reset_generation: 0 }] } : { rows: [] } }) };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  const result = await dispatch(app, 'GET', '/api/v1/owner/vocabulary', { cookie: 'kindle_sync_session=session' });
  assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(result.raw), { status: 'unavailable', count: null, items: [], next_cursor: null });
});

test('book detail returns tracked source data for an authenticated owner', async () => {
  const csrf = csrfFor('session'), bookId = '48bc0344-efad-4c68-adb6-dc0f0ba57276', sourceId = 'a'.repeat(64);
  const db = { query: async sql => sql.startsWith('SELECT username, csrf_hash') ? { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] } : { rows: [] },
    withTransaction: async work => work({ query: async sql => {
      if (sql.startsWith('SELECT instance_id')) return { rows: [{ reset_generation: 0 }] };
      if (sql.startsWith('SELECT b.book_id')) return { rows: [{ book_id: bookId, title: 'Synthetic', minimum_bytes: 73 }] };
      if (sql.startsWith('SELECT s.source_id')) return { rows: [{ source_id: sourceId, format: 'epub', title: 'Synthetic', authors: ['Example'], progress: null, last_opened_at: null, cover_available: false }] };
      if (sql.startsWith('SELECT COALESCE')) return { rows: [{ active_annotations: '0', archived_annotations: '0', active_days: '0', first_tracked_at: null, last_tracked_at: null }] };
      throw new Error('Unexpected query');
    } }) };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  const result = await dispatch(app, 'GET', `/api/v1/owner/books/${bookId}`, { cookie: 'kindle_sync_session=session' });
  assert.equal(result.statusCode, 200);
  const book = JSON.parse(result.raw), { validate } = await import('../../contracts/validate.js');
  assert.equal(validate('book', book), true); assert.equal(book.sources[0].source_id, sourceId); assert.equal(book.first_tracked_at, null);
});

test('owner config exposes the same nonsecret profile only to owner sessions', async () => {
  const csrf = csrfFor('session'), id = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
  const db = { query: async sql => {
    if (sql.startsWith('SELECT username, csrf_hash')) return { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] };
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reset_generation: 0 }] };
    if (sql.startsWith('SELECT token_hash, device_id')) return { rows: [{ device_id: id }] };
    return { rows: [] };
  } };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  assert.equal((await dispatch(app, 'GET', '/api/v1/owner/config')).statusCode, 401);
  assert.equal((await dispatch(app, 'GET', '/api/v1/owner/config', { authorization: 'Bearer token' })).statusCode, 403);
  const result = await dispatch(app, 'GET', '/api/v1/owner/config', { cookie: 'kindle_sync_session=session' });
  assert.equal(result.statusCode, 200); assert.equal(result.getHeader('Cache-Control'), 'private, no-store');
  const { validate } = await import('../../contracts/validate.js'); assert.equal(validate('config', JSON.parse(result.raw)), true);
});

test('book library returns a bounded page through the owner route', async () => {
  const csrf = csrfFor('session'), bookId = '48bc0344-efad-4c68-adb6-dc0f0ba57276', sourceId = 'a'.repeat(64);
  const db = { query: async sql => sql.startsWith('SELECT username, csrf_hash') ? { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] } : { rows: [] },
    withTransaction: async work => work({ query: async sql => {
      if (sql.startsWith('SELECT instance_id')) return { rows: [{ reset_generation: 0 }] };
      if (sql.startsWith('SELECT b.book_id FROM books')) return { rows: [{ book_id: bookId }] };
      if (sql.startsWith('SELECT b.book_id')) return { rows: [{ book_id: bookId, title: 'Synthetic', minimum_bytes: 73 }] };
      if (sql.startsWith('SELECT s.source_id')) return { rows: [{ source_id: sourceId, format: 'epub', title: 'Synthetic', authors: [], progress: null, last_opened_at: null, cover_available: false }] };
      if (sql.startsWith('SELECT COALESCE')) return { rows: [{ active_annotations: '0', archived_annotations: '0', active_days: '0', first_tracked_at: null, last_tracked_at: null }] };
      throw new Error('Unexpected query');
    } }) };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  const result = await dispatch(app, 'GET', '/api/v1/owner/books?limit=1', { cookie: 'kindle_sync_session=session' });
  assert.equal(result.statusCode, 200); const { validate } = await import('../../contracts/validate.js'); assert.equal(validate('books', JSON.parse(result.raw)), true);
});

test('grouping mutations validate inputs after owner CSRF protection', async () => {
  const csrf = csrfFor('session');
  const db = { query: async sql => sql.startsWith('SELECT username, csrf_hash') ? { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] } : { rows: [] } };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  const headers = { cookie: 'kindle_sync_session=session', origin: 'https://example.invalid', 'x-csrf-token': csrf, 'content-type': 'application/json', 'content-length': '2' };
  assert.equal((await dispatch(app, 'POST', '/api/v1/owner/books/merge', headers, '{}')).statusCode, 400);
  assert.equal((await dispatch(app, 'POST', '/api/v1/owner/books/bad/split', headers, '{}')).statusCode, 400);
});

test('match candidates are owner-only and reject malformed decisions', async () => {
  const csrf = csrfFor('session');
  const db = { query: async sql => sql.startsWith('SELECT username, csrf_hash') ? { rows: [{ username: 'synthetic', csrf_hash: createHash('sha256').update(csrf).digest('hex'), expires_at: new Date('2099-01-01T00:00:00Z') }] } : { rows: [] },
    withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ reset_generation: 0 }] } : { rows: [] } }) };
  const app = createApp({ db, config: loadConfig({ DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' }) });
  const owner = { cookie: 'kindle_sync_session=session' }, headers = { ...owner, origin: 'https://example.invalid', 'x-csrf-token': csrf, 'content-type': 'application/json', 'content-length': '2' };
  assert.equal((await dispatch(app, 'GET', '/api/v1/owner/matches')).statusCode, 401);
  const result = await dispatch(app, 'GET', '/api/v1/owner/matches', owner); assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(result.raw), { items: [], next_cursor: null });
  assert.equal((await dispatch(app, 'POST', '/api/v1/owner/matches', headers, '{}')).statusCode, 400);
});
