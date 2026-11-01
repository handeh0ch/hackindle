export function createStore(db) {
  return {
    async withLoginLock(username, ip, work) {
      return db.withTransaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([username, ip])]);
        return work({
          async cleanupFailures(since) { await client.query('DELETE FROM login_failures WHERE failed_at <= $1', [since]); },
          async failureCount(since) {
            const { rows: [row] } = await client.query('SELECT count(*) AS count FROM login_failures WHERE username = $1 AND ip = $2 AND failed_at > $3', [username, ip, since]);
            return Number(row.count);
          },
          async oldestFailure(since) {
            const { rows: [row] } = await client.query('SELECT min(failed_at) AS oldest FROM login_failures WHERE username = $1 AND ip = $2 AND failed_at > $3', [username, ip, since]);
            return row.oldest;
          },
          async owner() {
            const { rows: [row] } = await client.query('SELECT username, password_hash FROM owners WHERE username = $1', [username]);
            return row ? { username: row.username, passwordHash: row.password_hash } : null;
          },
          async recordFailure(at) { await client.query('INSERT INTO login_failures (username, ip, failed_at) VALUES ($1, $2, $3)', [username, ip, at]); },
          async clearFailures() { await client.query('DELETE FROM login_failures WHERE username = $1 AND ip = $2', [username, ip]); },
          async createSession(value) { await client.query('INSERT INTO owner_sessions (token_hash, username, csrf_hash, expires_at) VALUES ($1, $2, $3, $4)', [value.tokenHash, value.username, value.csrfHash, value.expiresAt]); },
        });
      });
    },
    async getSession(tokenHash) {
      const { rows: [row] } = await db.query('SELECT username, csrf_hash, expires_at FROM owner_sessions WHERE token_hash = $1', [tokenHash]);
      return row ? { username: row.username, csrfHash: row.csrf_hash, expiresAt: row.expires_at } : null;
    },
    async revokeSession(tokenHash) { await db.query('DELETE FROM owner_sessions WHERE token_hash = $1', [tokenHash]); },
    async rotateDevice(tokenHash) { await db.query('INSERT INTO device (singleton, token_hash) VALUES (TRUE, $1) ON CONFLICT (singleton) DO UPDATE SET token_hash = EXCLUDED.token_hash', [tokenHash]); },
    async getDevice(tokenHash) {
      const { rows: [row] } = await db.query('SELECT token_hash, device_id FROM device WHERE token_hash = $1', [tokenHash]);
      return row ? { deviceId: row.device_id } : null;
    },
    async bindDevice(tokenHash, deviceId) {
      const { rows } = await db.query('UPDATE device SET device_id = COALESCE(device_id, $2) WHERE token_hash = $1 AND (device_id IS NULL OR device_id = $2) RETURNING device_id', [tokenHash, deviceId]);
      return rows.length === 1;
    },
  };
}
