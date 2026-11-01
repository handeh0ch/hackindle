import { fileURLToPath } from 'node:url';
import { loadConfig, startupMessage } from '../server/config.js';
import { createDatabase, createPool } from '../server/db.js';
import { ensureInstancePolicy } from '../server/policy.js';
import { bootstrapInteractive } from '../server/cli.js';
export async function setupOwner(env = process.env, input = process.stdin, output = process.stdout, openPool = createPool, ensure = ensureInstancePolicy, setup = bootstrapInteractive) {
  const config = loadConfig(env), db = createDatabase({ pool: openPool(config) });
  try { await ensure(db, config); await setup(db, input, output); }
  finally { await db.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  setupOwner().catch(error => { process.stderr.write(startupMessage(error) + '\n'); process.exitCode = 1; });
}
