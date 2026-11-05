import { validate } from '../contracts/validate.js';
import { SyncError } from './sync.js';
import { READ_SNAPSHOT } from './read-snapshot.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const timeKey = expression => `upper(replace(substring(${expression} FROM 1 FOR 19), ' ', 'T')) || rpad(COALESCE(substring(${expression} FROM '[.]([0-9]+)'), ''), 9, '0')`;
export async function listCycles(db, raw) {
  const request = { ...raw };
  if (Object.keys(request).some(key => !['cursor', 'limit', 'byte_budget', 'book_id', 'source_id'].includes(key))) fail(400, 'invalid_request');
  for (const key of ['limit', 'byte_budget']) if (request[key] !== undefined) {
    if (typeof request[key] !== 'string' || !/^[1-9][0-9]*$/.test(request[key])) fail(400, 'invalid_request');
    request[key] = Number(request[key]);
  }
  if (!validate('list_query', request)) fail(400, 'invalid_request');
  const filters = [request.book_id?.toLowerCase() ?? null, request.source_id ?? null];
  let after = null;
  if (request.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 3 || JSON.stringify(cursor[0]) !== JSON.stringify(filters) || !uuid(cursor[1]) || !/^[0-9a-f]{64}$/.test(cursor[2]) || encode(cursor) !== request.cursor) throw new Error();
      after = cursor;
    } catch { fail(400, 'invalid_cursor'); }
  }
  const limit = request.limit ?? 50, budget = request.byte_budget ?? 262144;
  return db.withTransaction(async client => {
    await client.query(READ_SNAPSHOT);
    const { rows } = await client.query(`SELECT e.content->>'cycle_id' AS cycle_id, e.source_id, e.content->>'occurred_at' AS started_at,
      (SELECT f.content->>'occurred_at' FROM events f WHERE f.source_id = e.source_id AND f.content->>'type' = 'book_finished'
        AND (f.content->>'cycle_id')::uuid = (e.content->>'cycle_id')::uuid ORDER BY ${timeKey("f.content->>'occurred_at'")}, f.event_id LIMIT 1) AS finished_at
      FROM events e JOIN book_sources bs ON bs.source_id = e.source_id
      WHERE e.content->>'type' = 'cycle_started' AND ($1::uuid IS NULL OR bs.book_id = $1) AND ($2::text IS NULL OR e.source_id = $2)
      AND ($3::uuid IS NULL OR ((e.content->>'cycle_id')::uuid, e.source_id) > ($3::uuid, $4::text))
      AND e.event_id = (SELECT x.event_id FROM events x WHERE x.source_id = e.source_id AND x.content->>'type' = 'cycle_started' AND (x.content->>'cycle_id')::uuid = (e.content->>'cycle_id')::uuid ORDER BY ${timeKey("x.content->>'occurred_at'")}, x.event_id LIMIT 1)
      ORDER BY (e.content->>'cycle_id')::uuid, e.source_id LIMIT $5`, [...filters, after?.[1] ?? null, after?.[2] ?? null, limit + 1]);
    const complete = { items: rows, next_cursor: null };
    if (rows.length <= limit && Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;
    const items = [];
    for (let i = 0; i < Math.min(limit, rows.length); i++) {
      items.push(rows[i]);
      const next = i + 1 < rows.length ? encode([filters, rows[i].cycle_id, rows[i].source_id]) : null;
      if (Buffer.byteLength(JSON.stringify({ items, next_cursor: next })) > budget) {
        items.pop();
        if (!items.length) fail(413, 'item_too_large');
        return { items, next_cursor: encode([filters, rows[i - 1].cycle_id, rows[i - 1].source_id]) };
      }
    }
    const last = items.at(-1), result = { items, next_cursor: items.length < rows.length ? encode([filters, last.cycle_id, last.source_id]) : null };
    if (Buffer.byteLength(JSON.stringify(result)) > budget) fail(413, 'item_too_large');
    return result;
  });
}
