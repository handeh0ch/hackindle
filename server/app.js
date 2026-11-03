import express from 'express';
import { createStore } from './store.js';
import { createAuth } from './auth.js';
import { createHandlers } from './handlers.js';
import { createB2Router } from './b2-routes.js';
import { SyncError } from './sync.js';
export async function buildProfile(db, config) {
  const { rows: [row] } = await db.query('SELECT instance_id, reset_generation FROM instance WHERE singleton = TRUE');
  return { schema_version: 1, instance_id: row.instance_id, reset_generation: Number(row.reset_generation), reporting_timezone: config.reportingTimezone, characters_per_page: config.pageCharacters, limits: { direct_bytes: 1048576, envelope_bytes: 16777216, chunk_bytes: 1048576, upload_ttl_seconds: 604800, open_uploads: 2 } };
}
export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: 1048576 }));
  const handlers = createHandlers({ auth: createAuth({ store: createStore(db) }), config, profile: () => buildProfile(db, config) });
  app.post('/api/v1/auth/login', handlers.login);
  app.get('/api/v1/auth/session', handlers.session);
  app.post('/api/v1/auth/logout', handlers.logout);
  app.get('/api/v1/sync/config', handlers.profile);
  app.use('/api/v1/owner', handlers.owner);
  app.get('/api/v1/owner/config', async (req, res) => res.set('Cache-Control', 'private, no-store').json(await buildProfile(db, config)));
  app.use(createB2Router({ db }));
  app.post('/api/v1/owner/device/token', handlers.rotate);
  app.use((req, res) => res.status(404).json({ schema_version: 1, error: { code: 'not_found', message: 'not_found' } }));
  app.use((err, req, res, next) => {
    const status = err instanceof SyncError ? err.status : err.status === 400 || err.status === 413 ? err.status : 500;
    const code = err instanceof SyncError ? err.code : status === 400 ? 'invalid_request' : status === 413 ? 'too_large' : 'internal_error';
    if (status === 429) res.set('Retry-After', '300');
    res.status(status).json({ schema_version: 1, error: { code, message: code } });
  });
  return app;
}
