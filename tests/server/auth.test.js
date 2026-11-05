import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, hashPassword } from '../../server/auth.js';

function fakeStore(owner) {
  let failures = 0, session, device;
  return {
    async withLoginLock(username, ip, fn) { return fn({
      cleanupFailures: async () => {}, oldestFailure: async () => new Date(),
      failureCount: async () => failures,
      owner: async () => owner?.username === username ? owner : null,
      recordFailure: async () => { failures++; }, clearFailures: async () => { failures = 0; },
      createSession: async value => { session = value; },
    }); },
    async getSession(tokenHash) { return session?.tokenHash === tokenHash ? session : null; },
    async revokeSession(tokenHash) { if (session?.tokenHash === tokenHash) session = null; },
    async rotateDevice(tokenHash) { device = { tokenHash, deviceId: device?.deviceId ?? null }; },
    async getDevice(tokenHash) { return device?.tokenHash === tokenHash ? device : null; },
    async bindDevice(tokenHash, deviceId) { if (device?.tokenHash !== tokenHash) return false; if (device.deviceId && device.deviceId !== deviceId) return false; device.deviceId = deviceId; return true; },
  };
}
test('owner sessions persist, expire, require CSRF, and revoke on logout', async () => {
  const owner = { username: 'synthetic', passwordHash: await hashPassword('synthetic-password') };
  const store = fakeStore(owner); let now = Date.UTC(2024, 0, 1);
  const auth = createAuth({ store, now: () => now });
  const logged = await auth.login('synthetic', 'synthetic-password', '127.0.0.1');
  assert.equal(logged.status, 200);
  assert.equal((await createAuth({ store, now: () => now }).session(logged.token)).username, 'synthetic');
  assert.equal(await auth.checkCsrf(logged.token, logged.csrf), true);
  assert.equal(await auth.checkCsrf(logged.token, 'wrong'), false);
  await auth.logout(logged.token);
  assert.equal(await auth.session(logged.token), null);
  const again = await auth.login('synthetic', 'synthetic-password', '127.0.0.1');
  now += 14 * 86400000;
  assert.equal(await auth.session(again.token), null);
});
test('login throttles after five failures and device rotation preserves binding', async () => {
  const store = fakeStore({ username: 'synthetic', passwordHash: await hashPassword('synthetic-password') });
  const auth = createAuth({ store });
  for (let i = 0; i < 5; i++) assert.equal((await auth.login('synthetic', 'wrong', '127.0.0.1')).status, 401);
  assert.equal((await auth.login('synthetic', 'synthetic-password', '127.0.0.1')).status, 429);
  const first = await auth.rotateDevice();
  assert.equal(await auth.bindDevice(first, 'device-a'), true);
  assert.equal(await auth.bindDevice(first, 'device-b'), false);
  const second = await auth.rotateDevice();
  assert.equal(await auth.device(first), null);
  assert.equal((await auth.device(second)).deviceId, 'device-a');
});
import { createStore } from '../../server/store.js';
test('database auth boundary binds only the authorized device and maps persisted sessions', async () => {
  let device = null;
  const db = { query: async (sql, values) => {
    if (sql.startsWith('INSERT INTO device')) { device = { token_hash: values[0], device_id: device?.device_id ?? null }; return { rows: [] }; }
    if (sql.startsWith('SELECT token_hash')) return { rows: device?.token_hash === values[0] ? [device] : [] };
    if (sql.startsWith('UPDATE device')) {
      if (!device || device.token_hash !== values[0] || (device.device_id && device.device_id !== values[1])) return { rows: [] };
      device.device_id = values[1]; return { rows: [device] };
    }
    if (sql.startsWith('SELECT username')) return { rows: [{ username: 'synthetic', csrf_hash: 'hash', expires_at: new Date('2024-01-01T00:00:00Z') }] };
    return { rows: [] };
  } };
  const store = createStore(db);
  await store.rotateDevice('one');
  assert.equal(await store.bindDevice('one', 'a'), true);
  assert.equal(await store.bindDevice('one', 'b'), false);
  await store.rotateDevice('two');
  assert.equal(await store.getDevice('one'), null);
  assert.equal((await store.getDevice('two')).deviceId, 'a');
  assert.equal((await store.getSession('session')).csrfHash, 'hash');
});
test('persistent login boundary serializes attempts and stores only hashes', async () => {
  let failures = 0, session;
  const owner = { username: 'synthetic', password_hash: await hashPassword('synthetic-password') };
  const client = { query: async (sql, args) => {
    if (sql.startsWith('SELECT count')) return { rows: [{ count: String(failures) }] };
    if (sql.startsWith('SELECT username')) return { rows: [owner] };
    if (sql.startsWith('INSERT INTO login_failures')) failures++;
    if (sql.startsWith('DELETE FROM login_failures')) failures = 0;
    if (sql.startsWith('INSERT INTO owner_sessions')) session = args;
    return { rows: [] };
  } };
  const store = createStore({ withTransaction: async fn => fn(client) });
  const auth = createAuth({ store });
  assert.equal((await auth.login('synthetic', 'wrong', '127.0.0.1')).status, 401);
  assert.equal(failures, 1);
  const result = await auth.login('synthetic', 'synthetic-password', '127.0.0.1');
  assert.equal(result.status, 200); assert.equal(failures, 0);
  assert.notEqual(session[0], result.token); assert.notEqual(session[2], result.csrf);
});
import { createHandlers } from '../../server/handlers.js';
test('login and refreshed session expose the same usable CSRF token', async () => {
  const auth = createAuth({ store: fakeStore({ username: 'synthetic', passwordHash: await hashPassword('synthetic-password') }) });
  const handlers = createHandlers({ auth, config: { origin: 'https://example.invalid', secureCookies: true }, profile: async () => ({}) });
  const req = headers => ({ headers, body: { username: 'synthetic', password: 'synthetic-password' }, ip: '127.0.0.1', get(name) { return this.headers[name.toLowerCase()]; }, is(type) { return this.headers['content-type'] === type; } });
  const res = () => ({ set() { return this; }, cookie(name, value) { this.token = value; return this; }, json(value) { this.body = value; return this; }, status() { return this; } });
  const login = res(); await handlers.login(req({ origin: 'https://example.invalid', 'content-type': 'application/json' }), login);
  const refreshed = res(); await handlers.session(req({ cookie: `kindle_sync_session=${login.token}` }), refreshed);
  assert.equal(refreshed.body.csrf_token, login.body.csrf_token);
  assert.equal(await auth.checkCsrf(login.token, refreshed.body.csrf_token), true);
});
test('login lockout expires after its fifteen-minute window', async () => {
  let now = Date.UTC(2024, 0, 1); const failures = [];
  const owner = { username: 'synthetic', passwordHash: await hashPassword('synthetic-password') };
  const store = { withLoginLock: async (username, ip, work) => work({ cleanupFailures: async () => {}, oldestFailure: async since => failures.find(at => at > since), failureCount: async since => failures.filter(at => at > since).length, owner: async () => owner, recordFailure: async at => { failures.push(at); }, clearFailures: async () => {}, createSession: async () => {} }) };
  const auth = createAuth({ store, now: () => now });
  for (let i = 0; i < 5; i++) assert.equal((await auth.login('synthetic', 'wrong', '127.0.0.1')).status, 401);
  assert.equal((await auth.login('synthetic', 'synthetic-password', '127.0.0.1')).status, 429);
  now += 900000;
  assert.equal((await auth.login('synthetic', 'synthetic-password', '127.0.0.1')).status, 200);
});
test('competing first device bindings admit only one device identity', async () => {
  const auth = createAuth({ store: fakeStore(null) });
  const token = await auth.rotateDevice();
  const outcomes = await Promise.all([auth.bindDevice(token, 'synthetic-a'), auth.bindDevice(token, 'synthetic-b')]);
  assert.deepEqual(outcomes.sort(), [false, true]);
});
test('lockout reports seconds until the oldest current failure expires', async () => {
  const now = Date.UTC(2024, 0, 1, 0, 15, 0, 500);
  const store = { withLoginLock: async (user, ip, work) => work({ cleanupFailures: async () => {}, failureCount: async () => 5, oldestFailure: async () => new Date(now - 853500) }) };
  const result = await createAuth({ store, now: () => now }).login('synthetic', 'bad', '127.0.0.1');
  assert.equal(result.status, 429); assert.equal(result.retryAfter, 47);
});
test('login removes expired failures for other identities but retains the current window', async () => {
  const now = Date.UTC(2024, 0, 1, 1); const cutoff = now - 900000;
  let rows = [{ username: 'other', ip: 'one', at: cutoff - 1 }, { username: 'other', ip: 'boundary', at: cutoff }, { username: 'other', ip: 'two', at: cutoff + 1 }];
  const client = { query: async (sql, args) => {
    if (sql.startsWith('DELETE FROM login_failures WHERE failed_at')) rows = rows.filter(row => row.at > args[0].getTime());
    if (sql.startsWith('SELECT count')) return { rows: [{ count: '0' }] };
    if (sql.startsWith('SELECT username')) return { rows: [] };
    if (sql.startsWith('INSERT INTO login_failures')) rows.push({ username: args[0], ip: args[1], at: args[2].getTime() });
    return { rows: [] };
  } };
  const auth = createAuth({ store: createStore({ withTransaction: async work => work(client) }), now: () => now });
  assert.equal((await auth.login('unknown', 'synthetic', 'three')).status, 401);
  assert.deepEqual(rows.map(row => row.ip).sort(), ['three', 'two']);
});
test('database login boundary returns remaining lockout from oldest retained failure', async () => {
  const now = Date.UTC(2024, 0, 1, 0, 15, 0, 500), oldest = new Date(now - 853500);
  const client = { query: async sql => {
    if (sql.startsWith('SELECT count')) return { rows: [{ count: '5' }] };
    if (sql.startsWith('SELECT min')) return { rows: [{ oldest }] };
    return { rows: [] };
  } };
  const auth = createAuth({ store: createStore({ withTransaction: async work => work(client) }), now: () => now });
  assert.deepEqual(await auth.login('synthetic', 'unused', '127.0.0.1'), { status: 429, retryAfter: 47 });
});

test('restored device has no usable token until rotation and retains its identity', async () => {
  let device = { token_hash: null, device_id: 'synthetic-device' };
  const db = { query: async (sql, args) => {
    if (sql.startsWith('SELECT token_hash')) return { rows: [device].filter(row => row.token_hash !== null && row.token_hash === args[0]) };
    if (sql.startsWith('INSERT INTO device')) { device = { ...device, token_hash: args[0] }; return { rows: [] }; }
    throw new Error('Unexpected query');
  } };
  const auth = createAuth({ store: createStore(db) });
  assert.equal(await auth.device('arbitrary-token'), null);
  const token = await auth.rotateDevice(); assert.equal((await auth.device(token)).deviceId, 'synthetic-device');
});
test('owner can unbind the device so a replacement installation can bind with the same token', async () => {
  let bound = null, tokenHash = null;
  const db = { query: async (sql, args) => {
    if (sql.startsWith('INSERT INTO device')) { tokenHash = args[0]; return { rows: [] }; }
    if (sql.startsWith('UPDATE device SET device_id = NULL')) { assert.deepEqual(args, undefined); bound = null; return { rows: [] }; }
    if (sql.startsWith('UPDATE device SET device_id = COALESCE')) {
      if (tokenHash !== args[0] || (bound && bound !== args[1])) return { rows: [] };
      bound = args[1]; return { rows: [{ device_id: bound }] };
    }
    throw new Error('Unexpected query');
  } };
  const auth = createAuth({ store: createStore(db) });
  const token = await auth.rotateDevice(), first = 'a', replacement = 'b';
  assert.equal(await auth.bindDevice(token, first), true);
  assert.equal(await auth.bindDevice(token, replacement), false);
  await auth.unbindDevice();
  assert.equal(await auth.bindDevice(token, replacement), true);
  assert.equal(bound, replacement);
});
