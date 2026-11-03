import { validate } from '../contracts/validate.js';
import { SyncError } from './sync.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function progressHistory(db, source, raw) {
  if (!/^[0-9a-f]{64}$/.test(source)) fail(400, 'invalid_id');
  const request = { ...raw };
  if (Object.keys(request).some(key => !['cursor', 'limit', 'byte_budget'].includes(key))) fail(400, 'invalid_request');
  for (const key of ['limit', 'byte_budget']) if (request[key] !== undefined) {
    if (typeof request[key] !== 'string' || !/^[1-9][0-9]*$/.test(request[key])) fail(400, 'invalid_request');
    request[key] = Number(request[key]);
  }
  if (!validate('list_query', request)) fail(400, 'invalid_request');
  let after = null;
  if (request.cursor) {
    try {
      const value = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(value) || value.length !== 3 || value[0] !== source || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[0-9]{9}$/.test(value[1]) || !uuid(value[2]) || encode(value) !== request.cursor) throw new Error();
      after = value;
    } catch { fail(400, 'invalid_cursor'); }
  }
  const limit = request.limit ?? 50, budget = request.byte_budget ?? 262144;
  return db.withTransaction(async client => {
    await client.query('SELECT instance_id FROM instance WHERE singleton = TRUE FOR UPDATE');
    const exists = await client.query('SELECT source_id FROM sources WHERE source_id = $1', [source]);
    if (!exists.rows.length) fail(404, 'source_not_found');
    const time = "upper(replace(substring(e.content->'progress'->>'observed_at' FROM 1 FOR 19), ' ', 'T')) || rpad(COALESCE(substring(e.content->'progress'->>'observed_at' FROM '[.]([0-9]+)'), ''), 9, '0')";
    const size = "COALESCE(octet_length(e.content->'progress'->'position'->>'value'), 0) + COALESCE(octet_length(e.content->'progress'->'position'->>'geometry_version'), 0) + COALESCE(jsonb_array_length(e.content->'progress'->'position'->'boxes'), 0) * 20";
    const { rows } = await client.query(`SELECT e.event_id, CASE WHEN ${size} > $5 THEN NULL ELSE e.content->'progress' END AS progress, ${size} > $5 AS too_large, ${time} AS sort_time FROM events e
      WHERE e.source_id = $1 AND e.content->>'type' = 'progress_sample' AND ($2::text IS NULL OR (${time}, e.event_id) > ($2, $3::uuid))
      ORDER BY sort_time, e.event_id LIMIT $4`, [source, after?.[1] ?? null, after?.[2] ?? null, limit + 1, budget]);
    const complete = { items: rows.map(row => row.progress), next_cursor: null };
    if (rows.length <= limit && !rows.some(row => row.too_large) && Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;
    const items = [];
    for (let i = 0; i < Math.min(limit, rows.length); i++) {
      if (rows[i].too_large) {
        if (!items.length) fail(413, 'item_too_large');
        return { items, next_cursor: encode([source, rows[i - 1].sort_time, rows[i - 1].event_id]) };
      }
      items.push(rows[i].progress);
      const next = i + 1 < rows.length ? encode([source, rows[i].sort_time, rows[i].event_id]) : null;
      if (Buffer.byteLength(JSON.stringify({ items, next_cursor: next })) > budget) {
        items.pop();
        if (!items.length) fail(413, 'item_too_large');
        return { items, next_cursor: encode([source, rows[i - 1].sort_time, rows[i - 1].event_id]) };
      }
    }
    const next = items.length < rows.length ? encode([source, rows[items.length - 1].sort_time, rows[items.length - 1].event_id]) : null;
    const result = { items, next_cursor: next };
    if (Buffer.byteLength(JSON.stringify(result)) > budget) fail(413, 'item_too_large');
    return result;
  });
}
