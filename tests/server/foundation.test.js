import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.js';
import { UNICODE_VERSION } from '../../server/unicode-lower.js';
import { createDatabase } from '../../server/db.js';

const env = { DATABASE_URL: 'postgresql://synthetic:secret@example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'Europe/Berlin' };
test('configuration validates names without exposing submitted secrets', () => {
  const config = loadConfig(env);
  assert.equal(config.reportingTimezone, 'Europe/Berlin');
  assert.equal(config.pageCharacters, 2000);
  assert.ok(Object.isFrozen(config));
  for (const [name, value] of [['DATABASE_URL', 'secret'], ['APP_ORIGIN', 'http://example.invalid'], ['REPORT_TIMEZONE', 'bad/zone'], ['PORT', '99999'], ['TRUST_PROXY', '-1']]) {
    assert.throws(() => loadConfig({ ...env, [name]: value }), error => error.message.includes(name) && !error.message.includes(value));
  }
  assert.throws(() => loadConfig({ ...env, DATABASE_URL: '' }), /DATABASE_URL/);
});
test('transaction commits or rolls back using one client and always releases', async () => {
  const calls = [];
  const client = { query: async text => { calls.push(text); }, release: () => calls.push('release') };
  const db = createDatabase({ pool: { connect: async () => client } });
  assert.equal(await db.withTransaction(async tx => { assert.equal(tx, client); return 3; }), 3);
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'release']);
  calls.length = 0;
  await assert.rejects(db.withTransaction(async () => { throw new Error('synthetic'); }), /synthetic/);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'release']);
});
import { ensureInstancePolicy } from '../../server/policy.js';
test('initial policy persists and mismatched restart is rejected', async () => {
  let row;
  const db = { withTransaction: async fn => fn({ query: async (sql, params) => {
    if (sql.startsWith('INSERT')) { row ??= { instance_id: params[0], reporting_timezone: params[1], page_characters: params[2], reset_generation: 0 }; return { rows: [] }; }
    return { rows: [row] };
  } }) };
  const config = loadConfig(env);
  const first = await ensureInstancePolicy(db, config);
  assert.equal((await ensureInstancePolicy(db, config)).instanceId, first.instanceId);
  await assert.rejects(ensureInstancePolicy(db, { ...config, pageCharacters: 1000 }), /PAGE_CHARACTERS/);
  await assert.rejects(ensureInstancePolicy(db, { ...config, reportingTimezone: 'UTC' }), /REPORT_TIMEZONE/);
});
import { buildProfile } from '../../server/app.js';
test('profile exposes stored instance and policy but never database credentials', async () => {
  const config = loadConfig(env);
  const profile = await buildProfile({ query: async () => ({ rows: [{ instance_id: '48bc0344-efad-4c68-adb6-dc0f0ba57276', reset_generation: '4' }] }) }, config);
  assert.equal(profile.reset_generation, 4);
  assert.equal(profile.reporting_timezone, 'Europe/Berlin');
  assert.equal(profile.unicode_version, UNICODE_VERSION);
  assert.equal(JSON.stringify(profile).includes('secret'), false);
});
import { runMigrations } from '../../server/migrations.js';
test('migration applies once and records the successful version atomically', async () => {
  let applied = false, executions = 0;
  const db = { withTransaction: async work => work({ query: async sql => {
    if (sql.startsWith('SELECT version')) return { rows: applied ? [{ version: 1 }] : [] };
    if (sql === 'SYNTHETIC MIGRATION') executions++;
    if (sql.startsWith('INSERT INTO schema_migrations')) applied = true;
    return { rows: [] };
  } }) };
  await runMigrations(db, 'SYNTHETIC MIGRATION');
  await runMigrations(db, 'SYNTHETIC MIGRATION');
  assert.equal(executions, 1);
});
import { bootstrapOwner } from '../../server/bootstrap.js';
test('owner bootstrap stores a salted hash and refuses replacement', async () => {
  let saved;
  const db = { query: async (sql, values) => { if (saved) return { rows: [] }; saved = values; return { rows: [{ username: values[0] }] }; } };
  assert.equal(await bootstrapOwner(db, 'synthetic', 'synthetic-password'), true);
  assert.notEqual(saved[1], 'synthetic-password');
  assert.equal(await bootstrapOwner(db, 'another', 'another-password'), false);
  await assert.rejects(bootstrapOwner(db, '', ''), /owner/);
});
import { createApp } from '../../server/app.js';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
async function dispatch(app, method, path, headers = {}, body = '') {
  let raw = '';
  const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { raw += chunk.toString(); callback(); } });
  socket.remoteAddress = '127.0.0.1';
  const req = new IncomingMessage(socket); req.method = method; req.url = path; req.headers = headers;
  const res = new ServerResponse(req); res.assignSocket(socket);
  const done = new Promise(resolve => res.once('finish', resolve));
  req.push(body); req.push(null); app.handle(req, res); await done;
  return { status: res.statusCode, raw };
}
test('Express app has no listener and denies anonymous or device owner access', async () => {
  const config = loadConfig(env);
  const db = { query: async (sql, params) => ({ rows: sql.startsWith('SELECT token_hash') && params[0] ? [{ device_id: null }] : [] }) };
  const app = createApp({ db, config });
  const anonymous = await dispatch(app, 'GET', '/api/v1/owner/books');
  assert.equal(anonymous.status, 401);
  const device = await dispatch(app, 'GET', '/api/v1/owner/books', { authorization: 'Bearer synthetic' });
  assert.equal(device.status, 403);
  assert.equal((await dispatch(app, 'GET', '/not-a-route')).status, 404);
});
import { readHidden, bootstrapInteractive } from '../../server/cli.js';
import { PassThrough } from 'node:stream';
test('private terminal input hides characters and restores terminal state', async () => {
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false; input.setRawMode = value => { input.isRaw = value; };
  let output = ''; const pending = readHidden(input, { write: value => { output += value; } }, 'Secret: ');
  input.emit('keypress', 'a', { name: 'a' }); input.emit('keypress', 'b', { name: 'b' }); input.emit('keypress', '', { name: 'backspace' }); input.emit('keypress', '', { name: 'return' });
  assert.equal(await pending, 'a'); assert.equal(input.isRaw, false); assert.equal(output.includes('a'), false);
});
test('interactive bootstrap rejects mismatched confirmation before writing', async () => {
  let called = false; const answers = ['synthetic', 'one', 'two'];
  await assert.rejects(bootstrapInteractive({}, null, { write() {} }, async () => answers.shift(), async () => { called = true; }), /match/);
  assert.equal(called, false);
});
import { prepareApp, createProvider } from '../../server/runtime.js';
test('runtime checks policy before exposing a handler and provider initializes once', async () => {
  const calls = [];
  const prepare = async () => { calls.push('policy'); return (req, res) => { calls.push(req); res.end(); }; };
  const provider = createProvider(prepare);
  await provider('first', { end() {} }); await provider('second', { end() {} });
  assert.deepEqual(calls, ['policy', 'first', 'second']);
  let checked = false;
  const app = await prepareApp({}, {}, async () => { checked = true; }, () => 'handler');
  assert.equal(checked, true); assert.equal(app, 'handler');
});
import { start } from '../../index.js';
import { migrate } from '../../scripts/migrate.js';
import { setupOwner } from '../../scripts/setup-owner.js';
import provider from '../../server/provider.js';
test('standalone and CLI entrypoints release injected pools and never start during import', async () => {
  let closed = 0, migrated = false, ensured = false, setup = false;
  const pool = () => ({ end: async () => { closed++; } });
  const listener = await start({ env, openPool: pool, prepare: async () => ({ listen: (port, host) => ({ port, host }) }) });
  assert.deepEqual(listener, { port: 3000, host: '127.0.0.1' });
  await assert.rejects(start({ env, openPool: pool, prepare: async () => { throw new Error('synthetic'); } }), /synthetic/);
  await migrate(env, pool, async () => { migrated = true; });
  await setupOwner(env, null, null, pool, async () => { ensured = true; }, async () => { setup = true; });
  assert.equal(closed, 3); assert.equal(migrated && ensured && setup, true);
  assert.equal(typeof provider, 'function');
});
import { createPool } from '../../server/db.js';
test('pool wrapper delegates queries and closes without connecting', async () => {
  const pool = { query: async () => ({ rows: [1] }), end: async () => 'closed' };
  const db = createDatabase({ pool }); assert.deepEqual((await db.query('synthetic')).rows, [1]); assert.equal(await db.close(), 'closed');
  const pgPool = createPool(loadConfig(env)); await pgPool.end();
});
test('private terminal cancellation and bootstrap completion restore state', async () => {
  const input = new PassThrough(); input.isTTY = true; input.isRaw = false; input.setRawMode = value => { input.isRaw = value; };
  const pending = readHidden(input, { write() {} }, ''); input.emit('keypress', '', { ctrl: true, name: 'c' });
  await assert.rejects(pending, /cancelled/); assert.equal(input.isRaw, false);
  await assert.rejects(readHidden({}, { write() {} }, ''), /terminal/);
  const answers = ['synthetic', 'password', 'password']; let created;
  await bootstrapInteractive({}, null, { write() {} }, async () => answers.shift(), async (db, username, password) => { created = { username, password }; return true; });
  assert.equal(created.username, 'synthetic');
});
test('application handles malformed JSON and hides internal database errors', async () => {
  const app = createApp({ db: { query: async () => { throw new Error('synthetic-secret'); } }, config: loadConfig(env) });
  const invalid = await dispatch(app, 'POST', '/api/v1/auth/login', { 'content-type': 'application/json', 'content-length': '1', origin: 'https://example.invalid' }, '{');
  assert.equal(invalid.status, 400);
  const internal = await dispatch(app, 'GET', '/api/v1/sync/config', { authorization: 'Bearer synthetic' });
  assert.equal(internal.status, 500); assert.equal(internal.raw.includes('synthetic-secret'), false);
});
test('configuration supports local development and validates direct URL and page policy', () => {
  const local = loadConfig({ ...env, APP_ORIGIN: 'http://localhost:3000', DIRECT_DATABASE_URL: 'postgresql://example.invalid/migrate', PAGE_CHARACTERS: '4000', TRUST_PROXY: '2', PORT: '8080' });
  assert.equal(local.secureCookies, false); assert.equal(local.pageCharacters, 4000); assert.equal(local.trustProxy, 2);
  assert.throws(() => loadConfig({ ...env, DIRECT_DATABASE_URL: 'bad-secret' }), /DIRECT_DATABASE_URL/);
  assert.throws(() => loadConfig({ ...env, PAGE_CHARACTERS: '0' }), /PAGE_CHARACTERS/);
  assert.throws(() => loadConfig({ ...env, HOST: 'bad host' }), /HOST/);
});
test('transaction preserves original failure when rollback itself fails', async () => {
  let released = false;
  const client = { query: async sql => { if (sql === 'ROLLBACK') throw new Error('rollback failed'); }, release: () => { released = true; } };
  await assert.rejects(createDatabase({ pool: { connect: async () => client } }).withTransaction(async () => { throw new Error('original'); }), /original/);
  assert.equal(released, true);
});
import { makeProvider } from '../../server/provider.js';
test('provider adapter initializes the same app once with injected boundaries', async () => {
  let prepared = 0, handled = 0;
  const handler = makeProvider({ env, pool: () => ({}), prepare: async (db, config) => { prepared++; assert.equal(config.origin, 'https://example.invalid'); return () => { handled++; }; } });
  await handler({}, {}); await handler({}, {});
  assert.equal(prepared, 1); assert.equal(handled, 2);
});
import { validate as validateContract } from '../../contracts/validate.js';
test('device profile conforms to shared wire contract', async () => {
  const profile = await buildProfile({ query: async () => ({ rows: [{ instance_id: '48bc0344-efad-4c68-adb6-dc0f0ba57276', reset_generation: 0 }] }) }, loadConfig(env));
  assert.equal(validateContract('config', profile), true);
});
test('failed rollback destroys the client and preserves the original error', async () => {
  let releaseValue;
  const client = { query: async text => { if (text === 'ROLLBACK') throw new Error('rollback'); }, release: value => { releaseValue = value; } };
  await assert.rejects(createDatabase({ pool: { connect: async () => client } }).withTransaction(async () => { throw new Error('original'); }), /original/);
  assert.equal(releaseValue, true);
});
test('idle pool errors report generically without forwarding error details', async () => {
  const reported = []; const pool = createPool(loadConfig(env), (...args) => { reported.push(args); });
  pool.emit('error', new Error('synthetic-secret'));
  assert.deepEqual(reported, [[]]); await pool.end();
});
import { startupMessage } from '../../server/config.js';
test('startup reports safe configuration names but redacts external errors', () => {
  let configError; try { loadConfig({ ...env, DATABASE_URL: 'private-synthetic' }); } catch (error) { configError = error; }
  assert.match(startupMessage(configError), /DATABASE_URL/);
  assert.equal(startupMessage(new Error('synthetic-secret')), 'Startup failed; check configuration and database.');
});
test('provider initialization redacts external database errors and releases pool', async () => {
  let closed = false;
  const handler = makeProvider({ env, pool: () => ({ end: async () => { closed = true; } }), prepare: async () => { throw new Error('synthetic-secret'); } });
  await assert.rejects(handler({}, {}), error => !error.message.includes('synthetic-secret'));
  assert.equal(closed, true);
});
test('provider retries rejected initialization while concurrent callers share the retry', async () => {
  let calls = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  const handler = createProvider(async () => { calls++; if (calls === 1) throw new Error('temporary'); await ready; return req => req; });
  const failed = await Promise.allSettled([handler('first', {}), handler('also-first', {})]);
  assert.deepEqual(failed.map(result => result.status), ['rejected', 'rejected']); assert.equal(calls, 1);
  const a = handler('a', {}), b = handler('b', {}); release();
  assert.deepEqual(await Promise.all([a, b]), ['a', 'b']); assert.equal(calls, 2);
});
test('migration runner applies missing known versions in sequence exactly once', async () => {
  const applied = new Set([1]), executed = [];
  const db = { withTransaction: async work => work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT version')) return { rows: applied.has(args[0]) ? [{ version: args[0] }] : [] };
    if (sql === 'MIGRATION TWO') executed.push(2);
    if (sql.startsWith('INSERT INTO schema_migrations')) applied.add(args[0]);
    return { rows: [] };
  } }) };
  const versions = [{ version: 1, sql: 'MIGRATION ONE' }, { version: 2, sql: 'MIGRATION TWO' }];
  await runMigrations(db, versions); await runMigrations(db, versions);
  assert.deepEqual(executed, [2]);
});

test('default migrations include the legacy handshake migration', async () => {
  const applied = new Set(), versions = [];
  const db = { withTransaction: async work => work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT version')) return { rows: [] };
    if (sql.startsWith('INSERT INTO schema_migrations')) { versions.push(args[0]); applied.add(args[0]); }
    return { rows: [] };
  } }) };
  await runMigrations(db); assert.deepEqual(versions, [1, 2, 3, 4]);
});

test('legacy handshake barriers do not prevent reset from deleting sources', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../../db/migrations/004_legacy_handshake.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /REFERENCES\s+sources\s*\(/i);
});
