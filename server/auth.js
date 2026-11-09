import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export const csrfFor = token => createHmac('sha256', token).update('hackindle-csrf-v1').digest('base64url');
// Stored as scrypt$N$r$p$salt$hash so the cost can be raised later; hashes made
// before versioning (salt:hash, Node's default cost) still verify and are
// replaced by a current-cost hash after the next successful login.
const CURRENT = Object.freeze({ N: 65536, r: 8, p: 2 });
const KEY_LENGTH = 64;
const costOptions = ({ N, r, p }) => ({ N, r, p, maxmem: 256 * N * r });
function parseHash(encoded) {
  if (typeof encoded !== 'string') return null;
  const parts = encoded.split('$');
  if (parts[0] === 'scrypt' && parts.length === 6) {
    const [N, r, p] = parts.slice(1, 4).map(Number);
    const valid = [N, r, p].every(Number.isSafeInteger) && N >= 16384 && N <= 1048576 && (N & (N - 1)) === 0 && r >= 1 && r <= 32 && p >= 1 && p <= 16
      && /^[0-9a-f]{32}$/.test(parts[4]) && /^[0-9a-f]{128}$/.test(parts[5]);
    return valid ? { N, r, p, salt: parts[4], hex: parts[5] } : null;
  }
  const [salt, hex] = encoded.split(':');
  return /^[0-9a-f]{32}$/.test(salt) && /^[0-9a-f]{128}$/.test(hex ?? '') ? { N: 16384, r: 8, p: 1, salt, hex, legacy: true } : null;
}
export const needsRehash = encoded => {
  const parsed = parseHash(encoded);
  return !parsed || parsed.legacy === true || parsed.N < CURRENT.N || parsed.r < CURRENT.r || parsed.p < CURRENT.p;
};
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, KEY_LENGTH, costOptions(CURRENT));
  return `scrypt$${CURRENT.N}$${CURRENT.r}$${CURRENT.p}$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const parsed = parseHash(encoded);
  if (!parsed) return false;
  return timingSafeEqual(await scrypt(password, parsed.salt, KEY_LENGTH, costOptions(parsed)), Buffer.from(parsed.hex, 'hex'));
}
export function createAuth({ store, now = Date.now }) {
  async function session(token) {
    if (typeof token !== 'string' || !token) return null;
    const record = await store.getSession(digest(token));
    return record && new Date(record.expiresAt).getTime() > now() ? record : null;
  }
  return {
    async login(username, password, ip) {
      return store.withLoginLock(username, ip, async locked => {
        const since = new Date(now() - 900000);
        await locked.cleanupFailures(since);
        await locked.purgeSessions(new Date(now()));
        if (await locked.failureCount(since) >= 5) {
          const oldest = await locked.oldestFailure(since);
          return { status: 429, retryAfter: Math.max(1, Math.ceil((new Date(oldest).getTime() + 900000 - now()) / 1000)) };
        }
        const owner = await locked.owner();
        if (!owner || !await verifyPassword(password, owner.passwordHash)) {
          await locked.recordFailure(new Date(now()));
          return { status: 401 };
        }
        if (needsRehash(owner.passwordHash)) await locked.upgradePassword(owner.username, await hashPassword(password));
        await locked.clearFailures();
        const token = secret(), csrf = csrfFor(token), expiresAt = new Date(now() + 14 * 86400000).toISOString();
        await locked.createSession({ username: owner.username, tokenHash: digest(token), csrfHash: digest(csrf), expiresAt });
        return { status: 200, username: owner.username, token, csrf, expiresAt };
      });
    },
    session,
    async checkCsrf(token, csrf) {
      const record = await session(token);
      if (!record || typeof csrf !== 'string' || !/^[0-9a-f]{64}$/.test(record.csrfHash)) return false;
      return timingSafeEqual(Buffer.from(digest(csrf), 'hex'), Buffer.from(record.csrfHash, 'hex'));
    },
    async logout(token) { if (typeof token === 'string' && token) await store.revokeSession(digest(token)); },
    async rotateDevice() { const token = secret(); await store.rotateDevice(digest(token)); return token; },
    async unbindDevice() { await store.unbindDevice(); },
    async device(token) { return typeof token === 'string' && token ? store.getDevice(digest(token)) : null; },
    async bindDevice(token, deviceId) { return typeof token === 'string' && !!token && store.bindDevice(digest(token), deviceId); },
  };
}
