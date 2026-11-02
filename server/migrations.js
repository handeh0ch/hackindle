import { readFile } from 'node:fs/promises';
export async function runMigrations(db, migration) {
  const versions = typeof migration === 'string' ? [{ version: 1, sql: migration }] : migration ?? await Promise.all(
    ['001_initial.sql', '002_sync.sql'].map(async (name, index) => ({ version: index + 1, sql: await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8') }))
  );
  return db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(729037041)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const { version, sql } of versions) {
      const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [version]);
      if (!rows.length) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      }
    }
  });
}
