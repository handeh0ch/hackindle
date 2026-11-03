import { validate } from '../contracts/validate.js';
import { SyncError } from './sync.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function listAnnotations(db, raw) {
  const request = { ...raw };
  if (Object.keys(request).some(key => !['cursor', 'limit', 'byte_budget', 'book_id', 'source_id', 'search', 'archive'].includes(key))) fail(400, 'invalid_request');
  for (const key of ['limit', 'byte_budget']) if (request[key] !== undefined) {
    if (typeof request[key] !== 'string' || !/^[1-9][0-9]*$/.test(request[key])) fail(400, 'invalid_request');
    request[key] = Number(request[key]);
  }
  if (!validate('list_query', request)) fail(400, 'invalid_request');
  const filters = [request.book_id?.toLowerCase() ?? null, request.source_id ?? null, request.search ?? '', request.archive ?? 'active'];
  let after = null;
  if (request.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 2 || JSON.stringify(cursor[0]) !== JSON.stringify(filters) || !uuid(cursor[1]) || encode(cursor) !== request.cursor) throw new Error();
      after = cursor[1];
    } catch { fail(400, 'invalid_cursor'); }
  }
  const limit = request.limit ?? 50, budget = request.byte_budget ?? 262144;
  return db.withTransaction(async client => {
    await client.query('SELECT instance_id FROM instance WHERE singleton = TRUE FOR UPDATE');
    const { rows } = await client.query(`SELECT a.annotation_id, a.source_id, a.version, a.content->>'kind' AS kind, a.archived,
      left(a.content->>'quote', 500) AS quote_preview, left(a.content->>'note', 500) AS note_preview,
      COALESCE(a.content->'context'->>'status', 'none') AS context_status
      FROM annotations a JOIN book_sources bs ON bs.source_id = a.source_id
      WHERE ($1::uuid IS NULL OR bs.book_id = $1) AND ($2::text IS NULL OR a.source_id = $2)
      AND ($3 = '' OR position(lower($3) IN lower(a.content->>'quote')) > 0 OR position(lower($3) IN lower(a.content->>'note')) > 0)
      AND a.archived = ($4 = 'archived') AND ($5::uuid IS NULL OR a.annotation_id > $5::uuid)
      ORDER BY a.annotation_id LIMIT $6`, [...filters, after, limit + 1]);
    const mapped = rows.map(row => ({ ...row, version: Number(row.version) }));
    const complete = { items: mapped, next_cursor: null };
    if (mapped.length <= limit && Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;
    const items = [];
    for (let i = 0; i < Math.min(limit, mapped.length); i++) {
      items.push(mapped[i]);
      const next = i + 1 < mapped.length ? encode([filters, mapped[i].annotation_id]) : null;
      if (Buffer.byteLength(JSON.stringify({ items, next_cursor: next })) > budget) {
        items.pop();
        if (!items.length) fail(413, 'item_too_large');
        return { items, next_cursor: encode([filters, mapped[i - 1].annotation_id]) };
      }
    }
    const result = { items, next_cursor: items.length < mapped.length ? encode([filters, mapped[items.length - 1].annotation_id]) : null };
    if (Buffer.byteLength(JSON.stringify(result)) > budget) fail(413, 'item_too_large');
    return result;
  });
}
