import { validate } from '../../../contracts/validate.js';
import { SyncError } from '../sync/sync.js';
import { createSyncTx } from '../sync/sync-store.js';
import { readBook } from './books.js';
import { READ_SNAPSHOT } from './read-snapshot.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function listMatches(db, raw) {
  const request = { ...raw };
  if (Object.keys(request).some(key => !['cursor', 'limit', 'byte_budget'].includes(key))) fail(400, 'invalid_request');
  for (const key of ['limit', 'byte_budget']) if (request[key] !== undefined) {
    if (typeof request[key] !== 'string' || !/^[1-9][0-9]*$/.test(request[key])) fail(400, 'invalid_request');
    request[key] = Number(request[key]);
  }
  if (!validate('list_query', request)) fail(400, 'invalid_request');
  let cursor = null;
  if (request.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(request.cursor)) throw new Error();
      cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 2 || !/^[0-9a-f]{64}$/.test(cursor[0]) || !uuid(cursor[1]) || encode(cursor) !== request.cursor) throw new Error();
    } catch { fail(400, 'invalid_cursor'); }
  }
  const limit = request.limit ?? 50, budget = request.byte_budget ?? 262144;
  return db.withTransaction(async client => {
    await client.query(READ_SNAPSHOT);
    const { rows } = await client.query(`SELECT s.source_id, target.book_id AS candidate_book_id, 'same_title' AS reason
      FROM sources s JOIN book_sources own ON own.source_id = s.source_id
      JOIN sources other ON other.source_id <> s.source_id AND trim(s.metadata->>'title') <> '' AND lower(trim(other.metadata->>'title')) = lower(trim(s.metadata->>'title'))
      JOIN book_sources target ON target.source_id = other.source_id AND target.book_id <> own.book_id
      LEFT JOIN match_decisions d ON d.source_id = s.source_id AND d.candidate_book_id = target.book_id
      WHERE d.source_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM match_decisions rejected JOIN book_sources rejected_source ON rejected_source.source_id = rejected.source_id
        WHERE rejected.decision = 'reject' AND ((rejected_source.book_id = own.book_id AND rejected.candidate_book_id = target.book_id)
          OR (rejected_source.book_id = target.book_id AND rejected.candidate_book_id = own.book_id))
      ) AND ($1::text IS NULL OR (s.source_id, target.book_id) > ($1::text, $2::uuid))
      GROUP BY s.source_id, target.book_id ORDER BY s.source_id, target.book_id LIMIT $3`, [cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1]);
    const items = rows.slice(0, limit);
    while (true) {
      const last = items.at(-1), result = { items, next_cursor: items.length < rows.length && last ? encode([last.source_id, last.candidate_book_id]) : null };
      if (Buffer.byteLength(JSON.stringify(result)) <= budget && (items.length || rows.length === 0)) return result;
      if (items.length <= 1) fail(413, 'item_too_large');
      items.pop();
    }
  });
}
export async function decideMatch(db, action) {
  if (!validate('match_action', action)) fail(400, 'invalid_request');
  return db.withTransaction(async client => {
    const tx = createSyncTx(client); await tx.lock();
    const { rows: [source] } = await client.query('SELECT book_id FROM book_sources WHERE source_id = $1 FOR UPDATE', [action.source_id]);
    if (!source) fail(404, 'source_not_found');
    const { rows: [target] } = await client.query('SELECT book_id FROM books WHERE book_id = $1 FOR UPDATE', [action.book_id]);
    if (!target) fail(404, 'book_not_found');
    if (source.book_id.toLowerCase() === target.book_id.toLowerCase()) fail(409, 'already_grouped');
    if (action.decision === 'confirm') await tx.mergeSources(target.book_id, [action.source_id]);
    await client.query(`INSERT INTO match_decisions (source_id, candidate_book_id, decision) VALUES ($1,$2,$3)
      ON CONFLICT (source_id, candidate_book_id) DO UPDATE SET decision = EXCLUDED.decision`, [action.source_id, target.book_id, action.decision]);
    return readBook(client, action.decision === 'confirm' ? target.book_id : source.book_id);
  });
}
