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
  const end = res.end; res.end = function (...args) { const result = end.apply(this, args); done(); return result; };
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
