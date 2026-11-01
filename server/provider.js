import { loadConfig, startupMessage } from './config.js';
import { createDatabase, createPool } from './db.js';
import { createProvider, prepareApp } from './runtime.js';
export function makeProvider({ env = process.env, pool = createPool, prepare = prepareApp } = {}) {
  return createProvider(async () => {
    const config = loadConfig(env), db = createDatabase({ pool: pool(config) });
    try { return await prepare(db, config); }
    catch (error) { try { await db.close(); } catch {} throw new Error(startupMessage(error)); }
  });
}
export default makeProvider();
