import express from 'express';
import { bearer } from './handlers.js';
import { createSyncService, SyncError } from './sync.js';
import { createSyncTx } from './sync-store.js';
import { createUploadService } from './uploads.js';
import { createResetService } from './reset.js';
import { createContentService } from './content.js';
import { createCoverService } from './cover.js';
import { validate } from '../contracts/validate.js';
import { vocabulary } from './vocabulary.js';
import { bookDetail, listBooks, listSources } from './books.js';
import { mergeBooks, splitBook } from './grouping.js';
import { listMatches, decideMatch } from './matches.js';
import { progressHistory } from './progress-history.js';
import { listAnnotations } from './annotation-list.js';
import { listCycles } from './cycles.js';
import { listSessions } from './sessions.js';
import { statistics } from './reports.js';
import { safeTotal } from './safe-total.js';
import { READ_SNAPSHOT } from './read-snapshot.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function token(req) { const value = bearer(req); if (!value) fail(401, 'unauthorized'); return value; }
function json(req) { if (!req.is('application/json')) fail(415, 'json_required'); }
function uploadId(req) { if (!uuid(req.params.id)) fail(400, 'invalid_id'); return req.params.id; }
export function createB2Router({ db }) {
  const router = express.Router(), sync = createSyncService({ db, createTx: createSyncTx });
  const uploads = createUploadService({ db, createTx: createSyncTx, apply: sync.apply });
  const reset = createResetService({ db, createTx: createSyncTx }), content = createContentService(db), cover = createCoverService({ db, createTx: createSyncTx });
  async function goal(req, res) {
    if (!/^[0-9]{4}$/.test(req.params.year) || Number(req.params.year) === 0) fail(400, 'invalid_request');
    const year = Number(req.params.year);
    if (req.method === 'PUT' && !validate('goal_action', req.body)) fail(400, 'invalid_request');
    const row = await db.withTransaction(async client => {
      await client.query(req.method === 'PUT' ? 'SELECT instance_id FROM instance WHERE singleton = TRUE FOR UPDATE' : READ_SNAPSHOT);
      if (req.method === 'PUT') await client.query('INSERT INTO goals (year, target) VALUES ($1,$2) ON CONFLICT (year) DO UPDATE SET target = EXCLUDED.target', [year, req.body.target]);
      const { rows: [result] } = await client.query(`SELECT COALESCE((SELECT target FROM goals WHERE year = $1), 0) AS target,
      (SELECT count(DISTINCT bs.book_id) FROM events e JOIN book_sources bs ON bs.source_id = e.source_id
       WHERE e.content->>'type' = 'book_finished' AND EXTRACT(YEAR FROM
       ((substring(e.content->>'occurred_at' FROM 1 FOR 19)::timestamp AT TIME ZONE 'UTC') AT TIME ZONE instance.reporting_timezone)) = $1) AS completed_unique_books
      FROM instance WHERE singleton = TRUE`, [year]);
      return result;
    });
    res.set('Cache-Control', 'no-store').json({ year, target: safeTotal(row.target), completed_unique_books: safeTotal(row.completed_unique_books) });
  }
  router.get('/api/v1/owner/goals/:year', goal);
  router.put('/api/v1/owner/goals/:year', goal);
  router.get('/api/v1/owner/vocabulary', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await vocabulary(db, req.query)); });
  router.get('/api/v1/owner/books', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await listBooks(db, req.query)); });
  router.post('/api/v1/owner/books/merge', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await mergeBooks(db, req.body)); });
  router.post('/api/v1/owner/books/:id/split', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await splitBook(db, req.params.id, req.body)); });
  router.get('/api/v1/owner/matches', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await listMatches(db, req.query)); });
  router.post('/api/v1/owner/matches', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await decideMatch(db, req.body)); });
  router.get('/api/v1/owner/books/:id', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await bookDetail(db, req.params.id)); });
  router.get('/api/v1/owner/books/:id/sources', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await listSources(db, req.params.id, req.query)); });
  router.get('/api/v1/owner/sources/:source/progress', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await progressHistory(db, req.params.source, req.query)); });
  router.get('/api/v1/owner/annotations', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await listAnnotations(db, req.query)); });
  router.get('/api/v1/owner/cycles', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await listCycles(db, req.query)); });
  router.get('/api/v1/owner/sessions', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await listSessions(db, req.query)); });
  router.get('/api/v1/owner/statistics/daily', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await statistics(db, req.query, true)); });
  router.get('/api/v1/owner/statistics/summary', async (req, res) => { res.set('Cache-Control', 'private, no-store').json(await statistics(db, req.query)); });
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
