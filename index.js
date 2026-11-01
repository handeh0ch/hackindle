import { fileURLToPath } from "node:url";
import { loadConfig, startupMessage } from "./server/config.js";
import { createDatabase, createPool } from "./server/db.js";
import { prepareApp } from "./server/runtime.js";
export async function start({
  env = process.env,
  openPool = createPool,
  prepare = prepareApp,
} = {}) {
  const config = loadConfig(env),
    db = createDatabase({ pool: openPool(config) });
  try {
    const app = await prepare(db, config);
    return app.listen(config.port, config.host);
  } catch (error) {
    await db.close();
    throw error;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((error) => {
    process.stderr.write(startupMessage(error) + "\n");
    process.exitCode = 1;
  });
}
