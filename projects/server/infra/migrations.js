import { readFile, readdir } from 'node:fs/promises';
import { ConfigurationError } from './config.js';
// Every NNN_name.sql file is a migration, applied in numeric order, so a new
// file cannot be forgotten in a hard-coded list. Numbers must be 1..n without gaps.
export async function listMigrations(directory = new URL('../../../db/migrations/', import.meta.url)) {
  const names = (await readdir(directory)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  names.forEach((name, index) => { if (Number(name.slice(0, 3)) !== index + 1) throw new ConfigurationError('Migration files must be numbered 001.. without gaps'); });
  return Promise.all(names.map(async name => ({ version: Number(name.slice(0, 3)), sql: await readFile(new URL(name, directory), 'utf8') })));
}
export async function runMigrations(db, migration) {
  const versions = typeof migration === 'string' ? [{ version: 1, sql: migration }] : migration ?? await listMigrations();
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
