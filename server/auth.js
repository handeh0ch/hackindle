import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export const csrfFor = token => createHmac('sha256', token).update('kindle-sync-csrf-v1').digest('base64url');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [salt, hex] = encoded.split(':');
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(hex ?? '')) return false;
  return timingSafeEqual(await scrypt(password, salt, 64), Buffer.from(hex, 'hex'));
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
        if (await locked.failureCount(since) >= 5) {
          const oldest = await locked.oldestFailure(since);
          return { status: 429, retryAfter: Math.max(1, Math.ceil((new Date(oldest).getTime() + 900000 - now()) / 1000)) };
        }
        const owner = await locked.owner();
        if (!owner || !await verifyPassword(password, owner.passwordHash)) {
          await locked.recordFailure(new Date(now()));
          return { status: 401 };
        }
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
    async device(token) { return typeof token === 'string' && token ? store.getDevice(digest(token)) : null; },
    async bindDevice(token, deviceId) { return typeof token === 'string' && !!token && store.bindDevice(digest(token), deviceId); },
  };
}
