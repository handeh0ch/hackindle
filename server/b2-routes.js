import express from 'express';
import { bearer } from './handlers.js';
import { createSyncService, SyncError } from './sync.js';
import { createSyncTx } from './sync-store.js';
import { createUploadService } from './uploads.js';
import { createResetService } from './reset.js';
import { createContentService } from './content.js';
import { createCoverService } from './cover.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function token(req) { const value = bearer(req); if (!value) fail(401, 'unauthorized'); return value; }
function json(req) { if (!req.is('application/json')) fail(415, 'json_required'); }
function uploadId(req) { if (!uuid(req.params.id)) fail(400, 'invalid_id'); return req.params.id; }
export function createB2Router({ db }) {
  const router = express.Router(), sync = createSyncService({ db, createTx: createSyncTx });
  const uploads = createUploadService({ db, createTx: createSyncTx, apply: sync.apply });
  const reset = createResetService({ db, createTx: createSyncTx }), content = createContentService(db), cover = createCoverService({ db, createTx: createSyncTx });
  router.post('/api/v1/sync', async (req, res) => { const key = token(req); json(req); res.set('Cache-Control', 'no-store').json(await sync.ingest(key, req.body)); });
  router.post('/api/v1/uploads', async (req, res) => { const key = token(req); json(req); res.status(201).set('Cache-Control', 'no-store').json(await uploads.create(key, req.body)); });
  router.put('/api/v1/uploads/:id/chunks/:index', express.raw({ type: 'application/octet-stream', limit: 1048576 }), async (req, res) => {
    const key = token(req), id = uploadId(req);
    if (!req.is('application/octet-stream')) fail(415, 'binary_required');
    if (!/^(0|[1-9][0-9]*)$/.test(req.params.index)) fail(400, 'invalid_chunk');
    await uploads.put(key, id, Number(req.params.index), req.body); res.status(204).end();
  });
  router.post('/api/v1/uploads/:id/commit', async (req, res) => { const key = token(req); res.set('Cache-Control', 'no-store').json(await uploads.commit(key, uploadId(req))); });
  router.put('/api/v1/sources/:source/cover', express.raw({ type: ['image/jpeg', 'image/webp'], limit: 65536 }), async (req, res) => {
    const key = token(req), generation = req.get('x-reset-generation');
    if (!/^(0|[1-9][0-9]*)$/.test(generation ?? '')) fail(400, 'invalid_request');
    const type = req.is('image/jpeg') ? 'image/jpeg' : req.is('image/webp') ? 'image/webp' : null;
    if (!type) fail(415, 'invalid_cover');
    await cover.put(key, req.get('x-device-id'), Number(generation), req.params.source, type, req.body); res.status(204).end();
  });
  router.post('/api/v1/owner/reset', async (req, res) => { res.set('Cache-Control', 'no-store').json(await reset(req.body)); });
  router.get('/api/v1/owner/annotations/:id', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await content.detail(req.params.id)); });
  router.get('/api/v1/owner/annotations/:id/content', async (req, res) => {
    const query = { ...req.query };
    if (query.version !== undefined) { if (!/^[1-9][0-9]*$/.test(query.version)) fail(400, 'invalid_request'); query.version = Number(query.version); }
    res.set('Cache-Control', 'private, no-store').json(await content.content(req.params.id, query));
  });
  router.get('/api/v1/owner/sources/:source/cover', async (req, res) => { const image = await cover.get(req.params.source); res.set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'private, no-store').type(image.type).send(image.bytes); });
  router.get('/api/v1/owner/device', async (req, res) => {
    const { rows: [row] } = await db.query('SELECT instance.reset_generation, device.device_id, device.last_sync_at FROM instance LEFT JOIN device ON device.singleton = TRUE WHERE instance.singleton = TRUE');
    res.set('Cache-Control', 'no-store').json({ device_id: row.device_id, last_sync_at: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null, reset_generation: Number(row.reset_generation) });
  });
  return router;
}
