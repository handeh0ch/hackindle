import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { createAuth, hashPassword, needsRehash } from '../../projects/server/auth/auth.js';

function storeFor(owner) {
  const upgrades = [];
  return {
    upgrades,
    withLoginLock: async (username, ip, work) => work({
      cleanupFailures: async () => {}, purgeSessions: async () => {}, failureCount: async () => 0, oldestFailure: async () => new Date(),
      owner: async () => owner.username === username ? owner : null,
      recordFailure: async () => {}, clearFailures: async () => {}, createSession: async () => {},
      upgradePassword: async (name, encoded) => { upgrades.push(name); owner.passwordHash = encoded; },
    }),
  };
}
const login = (store, password) => createAuth({ store }).login('synthetic', password, '127.0.0.1');

test('new password hashes carry their cost and verify at the current cost', async () => {
  const hash = await hashPassword('synthetic-password');
  assert.match(hash, /^scrypt\$65536\$8\$2\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(needsRehash(hash), false);
  const store = storeFor({ username: 'synthetic', passwordHash: hash });
  assert.equal((await login(store, 'synthetic-password')).status, 200);
  assert.equal((await login(store, 'wrong-password')).status, 401);
  assert.deepEqual(store.upgrades, [], 'a current-cost hash is not rewritten');
});

test('a hash from before cost versioning still verifies and is upgraded after login', async () => {
  const salt = randomBytes(16).toString('hex');
  const legacy = salt + ':' + scryptSync('legacy-password-1', salt, 64).toString('hex');
  assert.equal(needsRehash(legacy), true);
  const owner = { username: 'synthetic', passwordHash: legacy }, store = storeFor(owner);
  assert.equal((await login(store, 'wrong-password-1')).status, 401);
  assert.equal(owner.passwordHash, legacy, 'a failed login never rewrites the hash');
  assert.equal((await login(store, 'legacy-password-1')).status, 200);
  assert.deepEqual(store.upgrades, ['synthetic']);
  assert.match(owner.passwordHash, /^scrypt\$65536\$8\$2\$/);
  assert.equal((await login(store, 'legacy-password-1')).status, 200);
  assert.equal(store.upgrades.length, 1, 'the upgraded hash is not upgraded again');
});

test('malformed or out-of-range password hashes never authenticate', async () => {
  const [, , r, p, salt, hex] = (await hashPassword('synthetic-password')).split('$');
  const make = (n, rr, pp, s, h) => ['scrypt', n, rr, pp, s, h].join('$');
  const bad = [null, '', make(3, r, p, salt, hex), ['scrypt', 65536, r, p, salt].join('$'), make(65535, r, p, salt, hex), make(65536, 0, p, salt, hex),
    make(65536, r, 99, salt, hex), make(65536, r, p, 'nothex', hex), salt + ':short'];
  for (const value of bad) {
    assert.equal(needsRehash(value), true);
    assert.equal((await login(storeFor({ username: 'synthetic', passwordHash: value }), 'synthetic-password')).status, 401);
  }
  assert.equal(needsRehash(make(16384, r, p, salt, hex)), true, 'a lower cost than the current one is upgraded');
});
