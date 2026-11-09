import { ensureInstancePolicy } from './policy.js';
import { createApp } from '../http/app.js';
export async function prepareApp(db, config, ensure = ensureInstancePolicy, create = createApp) {
  await ensure(db, config);
  return create({ db, config });
}
export function createProvider(prepare) {
  let ready;
  return async (req, res) => {
    ready ??= Promise.resolve().then(prepare).catch(error => { ready = undefined; throw error; });
    const app = await ready;
    return app(req, res);
  };
}
