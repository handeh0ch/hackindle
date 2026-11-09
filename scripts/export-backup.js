import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, startupMessage } from '../projects/server/infra/config.js';
import { createDatabase, createPool } from '../projects/server/infra/db.js';
import { exportBackup } from '../projects/server/infra/backup.js';
export async function exportFile(env = process.env, path = process.argv[2], openPool = createPool, save = writeFile, run = exportBackup) {
  if (typeof path !== 'string' || !path) throw new Error('Backup path required');
  const config = loadConfig(env), db = createDatabase({ pool: openPool(config) });
  try { await save(path, JSON.stringify(await run(db)), { flag: 'wx', mode: 0o600 }); }
  finally { await db.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  exportFile().catch(error => { process.stderr.write(startupMessage(error) + '\n'); process.exitCode = 1; });
}
