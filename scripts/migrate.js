import { fileURLToPath } from 'node:url';
import { loadConfig, startupMessage } from '../server/config.js';
import { createDatabase, createPool } from '../server/db.js';
import { runMigrations } from '../server/migrations.js';
export async function migrate(env = process.env, openPool = createPool, run = runMigrations) {
  const config = loadConfig(env);
  const db = createDatabase({ pool: openPool({ ...config, databaseUrl: config.directDatabaseUrl }) });
  try { await run(db); } finally { await db.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().catch(error => { process.stderr.write(startupMessage(error) + '\n'); process.exitCode = 1; });
}
