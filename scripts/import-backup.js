import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, startupMessage } from '../projects/server/infra/config.js';
import { createDatabase, createPool } from '../projects/server/infra/db.js';
import { restoreBackup } from '../projects/server/infra/backup.js';
export async function importFile(env = process.env, path = process.argv[2], openPool = createPool, read = readFile, run = restoreBackup) {
  if (typeof path !== 'string' || !path) throw new Error('Backup path required');
  const config = loadConfig(env), data = JSON.parse(await read(path, 'utf8')), db = createDatabase({ pool: openPool(config) });
  try { await run(db, config, data); }
  finally { await db.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  importFile().catch(error => { process.stderr.write(startupMessage(error) + '\n'); process.exitCode = 1; });
}
