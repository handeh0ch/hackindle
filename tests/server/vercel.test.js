import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';
import app from '../../app.js';
import { SECURITY_HEADERS } from '../../projects/server/http/app.js';

const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

async function dispatch(target, method, path) {
  const socket = new Duplex({ highWaterMark: 1 << 24, read() {}, write(chunk, encoding, callback) { callback(); } }); socket.remoteAddress = '127.0.0.1';
  const req = new IncomingMessage(socket); req.method = method; req.url = path; req.headers = {};
  const res = new ServerResponse(req); res.assignSocket(socket);
  let done; const finished = new Promise(resolve => { done = resolve; });
  const end = res.end; res.end = function (...args) { res.raw = String(args[0] ?? ''); const result = end.apply(this, args); done(); return result; };
  target.handle(req, res); req.push(null); await finished; return res;
}

test('the Vercel entry is an Express app that opens no listener and fails closed without configuration', async () => {
  assert.equal(typeof app.handle, 'function');
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = chunk => { written.push(String(chunk)); return true; };
  const saved = { DATABASE_URL: process.env.DATABASE_URL, APP_ORIGIN: process.env.APP_ORIGIN };
  delete process.env.DATABASE_URL; delete process.env.APP_ORIGIN;
  try {
    const response = await dispatch(app, 'GET', '/api/v1/auth/session');
    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.raw), { schema_version: 1, error: { code: 'internal_error', message: 'internal_error' } });
    assert.ok(!/DATABASE_URL|postgres/i.test(response.raw), 'the response never names settings or values');
    assert.ok(written.join('').length > 0, 'the operator still gets a log line');
  } finally {
    process.stderr.write = original;
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
  }
});

test('vercel.json sets the same security headers the Express static mount sets', () => {
  const config = JSON.parse(read('vercel.json'));
  const entry = config.headers.find(item => item.source === '/(.*)');
  assert.ok(entry, 'a catch-all header rule exists');
  const headers = Object.fromEntries(entry.headers.map(item => [item.key.toLowerCase(), item.value]));
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(headers[key.toLowerCase()], value, key);
  assert.match(headers['content-security-policy'], /default-src 'self'/);
  assert.ok(!/(postgres|token|secret|password|neon|vercel\.app)/i.test(JSON.stringify(config)), 'no value or provider identifier is committed');
});

test('.vercelignore keeps env files, local data, tests, docs and the plugin out of the deployment', () => {
  const lines = read('.vercelignore').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const entry of ['.env', '.env.*', '.local', 'private', 'backups', 'exports', 'tests', 'docs', 'projects/plugin', 'node_modules']) assert.ok(lines.includes(entry), entry);
  assert.ok(!lines.some(line => line.startsWith('!.env')), 'no exception that would ship an env file');
});
