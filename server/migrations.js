import { readFile } from 'node:fs/promises';
export async function runMigrations(db, migration) {
  const sql = migration ?? await readFile(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8');
  return db.withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(729037041)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [1]);
    if (!rows.length) {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [1]);
    }
  });
}
