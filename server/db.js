import pg from 'pg';
export function createDatabase({ pool }) {
  return {
    query: (text, values) => pool.query(text, values),
    close: () => pool.end(),
    async withTransaction(work) {
      const client = await pool.connect();
      let destroy = false;
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { destroy = true; }
        throw error;
      } finally { client.release(destroy); }
    },
  };
}
export function createPool(config, report = () => process.stderr.write('Database pool connection error.\n')) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  pool.on('error', () => report());
  return pool;
}
