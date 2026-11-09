import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../../projects/server/http/handlers.js';
test('HTTP auth handlers enforce origin, CSRF and device/owner scopes', async () => {
  const auth = {
    login: async () => ({ status: 200, username: 'synthetic', token: 'session', csrf: 'csrf', expiresAt: '2024-01-15T00:00:00Z' }),
    session: async token => token === 'session' ? { username: 'synthetic', expiresAt: '2024-01-15T00:00:00Z', csrfHash: 'stored' } : null,
    checkCsrf: async (token, csrf) => token === 'session' && csrf === 'csrf',
    device: async token => token === 'device' ? { deviceId: null } : null,
    rotateDevice: async () => 'new-device', logout: async () => {},
  };
  const handlers = createHandlers({ auth, config: { origin: 'https://example.invalid', secureCookies: true }, profile: async () => ({ schema_version: 1 }) });
  const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; }, set(name, value) { this.headers[name] = value; return this; }, cookie(name, value, options) { this.savedCookie = { name, value, options }; return this; }, clearCookie() { return this; } });
  const request = (headers = {}, body = {}) => ({ headers, body, ip: '127.0.0.1', method: 'POST', get(name) { return this.headers[name.toLowerCase()]; }, is(type) { return this.headers['content-type'] === type; } });
  let res = response(); await handlers.login(request({ origin: 'https://evil.invalid', 'content-type': 'application/json' }, { username: 'synthetic', password: 'pass' }), res); assert.equal(res.statusCode, 403);
  res = response(); await handlers.login(request({ origin: 'https://example.invalid', 'content-type': 'application/json' }, { username: 'synthetic', password: 'pass' }), res); assert.equal(typeof res.body.csrf_token, 'string'); assert.equal(res.savedCookie.options.httpOnly, true);
  res = response(); await handlers.owner(request({ authorization: 'Bearer device' }), res, () => {}); assert.equal(res.statusCode, 403);
  res = response(); await handlers.owner(request({ cookie: 'hackindle_session=session', origin: 'https://example.invalid' }), res, () => {}); assert.equal(res.statusCode, 403);
  let next = false; res = response(); await handlers.owner(request({ cookie: 'hackindle_session=session', origin: 'https://example.invalid', 'x-csrf-token': 'csrf', 'content-type': 'application/json' }), res, () => { next = true; }); assert.equal(next, true);
  res = response(); await handlers.profile(request({ authorization: 'Bearer device' }), res); assert.equal(res.body.schema_version, 1);
});
test('session refresh, logout, token rotation and request failures use safe responses', async () => {
  let revoked = false;
  const auth = { login: async () => ({ status: 429 }), session: async token => token === 'session' ? { username: 'synthetic', expiresAt: '2024-01-15T00:00:00Z' } : null, checkCsrf: async (token, csrf) => token === 'session' && csrf === 'csrf', logout: async () => { revoked = true; }, device: async () => null, rotateDevice: async () => 'rotated' };
  const h = createHandlers({ auth, config: { origin: 'https://example.invalid', secureCookies: true }, profile: async () => ({}) });
  const req = (headers = {}, body = {}) => ({ headers, body, ip: '127.0.0.1', method: 'POST', get(name) { return this.headers[name.toLowerCase()]; }, is(type) { return this.headers['content-type'] === type; } });
  const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() { return this; }, cookie() { return this; }, clearCookie() { this.cleared = true; return this; }, end() { return this; } });
  let r = res(); await h.session(req(), r); assert.equal(r.statusCode, 401);
  r = res(); await h.session(req({ cookie: 'hackindle_session=session' }), r); assert.equal(r.body.owner.username, 'synthetic'); assert.ok(r.body.csrf_token);
  r = res(); await h.logout(req({ cookie: 'hackindle_session=session', origin: 'https://example.invalid', 'x-csrf-token': 'wrong' }), r); assert.equal(r.statusCode, 403); assert.equal(revoked, false);
  r = res(); await h.logout(req({ cookie: 'hackindle_session=session', origin: 'https://example.invalid', 'x-csrf-token': 'csrf' }), r); assert.equal(r.statusCode, 204); assert.equal(revoked, true); assert.equal(r.cleared, true);
  r = res(); await h.rotate(req(), r); assert.equal(r.body.device_token, 'rotated');
  r = res(); await h.login(req({ origin: 'https://example.invalid' }), r); assert.equal(r.statusCode, 415);
  r = res(); await h.login(req({ origin: 'https://example.invalid', 'content-type': 'application/json' }, {}), r); assert.equal(r.statusCode, 400);
  r = res(); await h.login(req({ origin: 'https://example.invalid', 'content-type': 'application/json' }, { username: 'u', password: 'p' }), r); assert.equal(r.statusCode, 429);
  r = res(); await h.profile(req(), r); assert.equal(r.statusCode, 401);
});
test('token rotation accepts only an empty object and never rotates malformed requests', async () => {
  let rotations = 0;
  const handler = createHandlers({ auth: { rotateDevice: async () => { rotations++; return 'synthetic'; } }, config: {}, profile: async () => ({}) });
  const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; }, set() { return this; } });
  for (const body of [undefined, null, [], { unexpected: true }]) { const res = response(); await handler.rotate({ body }, res); assert.equal(res.statusCode, 400); }
  assert.equal(rotations, 0);
  const res = response(); await handler.rotate({ body: {} }, res); assert.equal(res.statusCode, 200); assert.equal(rotations, 1);
});
test('login throttle response carries the remaining Retry-After seconds', async () => {
  const handler = createHandlers({ auth: { login: async () => ({ status: 429, retryAfter: 47 }) }, config: { origin: 'https://example.invalid' }, profile: async () => ({}) });
  const req = { body: { username: 'synthetic', password: 'synthetic' }, ip: '127.0.0.1', get: () => 'https://example.invalid', is: () => true };
  const res = { headers: {}, status(code) { this.statusCode = code; return this; }, json() { return this; }, set(name, value) { this.headers[name] = value; return this; } };
  await handler.login(req, res); assert.equal(res.statusCode, 429); assert.equal(res.headers['Retry-After'], '47');
});
test('device unbind accepts only an empty object and answers 204 without a body', async () => {
  let unbinds = 0;
  const handler = createHandlers({ auth: { unbindDevice: async () => { unbinds++; } }, config: {}, profile: async () => ({}) });
  const response = () => ({ statusCode: 200, ended: false, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; }, set() { return this; }, end() { this.ended = true; return this; } });
  for (const body of [undefined, null, [], { unexpected: true }]) { const res = response(); await handler.unbind({ body }, res); assert.equal(res.statusCode, 400); }
  assert.equal(unbinds, 0);
  const res = response(); await handler.unbind({ body: {} }, res); assert.equal(res.statusCode, 204); assert.equal(res.ended, true); assert.equal(unbinds, 1);
});
