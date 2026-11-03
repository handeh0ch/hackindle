import { SyncError } from './sync.js';
import { validate } from '../contracts/validate.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const instantKey = value => {
  const [whole, fraction = ''] = value.slice(0, -1).split('.');
  return whole.toUpperCase().replace(' ', 'T') + fraction.padEnd(9, '0');
};
const timeKey = expression => `upper(replace(substring(${expression} FROM 1 FOR 19), ' ', 'T')) || rpad(COALESCE(substring(${expression} FROM '[.]([0-9]+)'), ''), 9, '0')`;
const eventKey = timeKey("e.content->>'occurred_at'");
const sampleJoin = `LEFT JOIN LATERAL (SELECT e.content->'progress' AS progress FROM events e
  WHERE e.source_id = s.source_id AND e.content->>'type' = 'progress_sample'
  ORDER BY ${timeKey("e.content->'progress'->>'observed_at'")} DESC, e.event_id DESC LIMIT 1) sample ON TRUE`;
const chosenJoin = `CROSS JOIN LATERAL (SELECT CASE WHEN s.progress IS NULL OR (sample.progress IS NOT NULL AND
  ${timeKey("sample.progress->>'observed_at'")} > ${timeKey("s.progress->>'observed_at'")})
  THEN sample.progress ELSE s.progress END AS progress) chosen`;
export async function readBook(client, id, budget = 262144) {
  if (!uuid(id)) fail(400, 'invalid_id');
  const { rows: [book] } = await client.query(`SELECT b.book_id, b.title, octet_length(b.title) + COALESCE(sum(
    64 + octet_length(s.metadata->>'title') + COALESCE((SELECT sum(octet_length(a)) FROM jsonb_array_elements_text(s.metadata->'authors') a), 0)
    + COALESCE(octet_length(chosen.progress->'position'->>'value'), 0) + COALESCE(octet_length(chosen.progress->'position'->>'geometry_version'), 0)
    + COALESCE(jsonb_array_length(chosen.progress->'position'->'boxes'), 0) * 20), 0) AS minimum_bytes
    FROM books b LEFT JOIN book_sources bs ON bs.book_id = b.book_id LEFT JOIN sources s ON s.source_id = bs.source_id
    ${sampleJoin} ${chosenJoin}
    WHERE b.book_id = $1 GROUP BY b.book_id`, [id]);
  if (!book) fail(404, 'book_not_found');
  if (Number(book.minimum_bytes) > budget) fail(413, 'item_too_large');
  const { rows: sourceRows } = await client.query(`SELECT s.source_id, s.format, s.metadata->>'title' AS title, s.metadata->'authors' AS authors,
    s.progress, sample.progress AS event_progress, s.cover IS NOT NULL AS cover_available,
    (SELECT e.content->>'occurred_at' FROM events e WHERE e.source_id = s.source_id AND e.content->>'type' = 'session_started'
      ORDER BY ${eventKey} DESC, e.event_id DESC LIMIT 1) AS last_opened_at
    FROM sources s JOIN book_sources bs ON bs.source_id = s.source_id ${sampleJoin} WHERE bs.book_id = $1 ORDER BY s.source_id`, [id]);
  const sources = sourceRows.map(({ event_progress, ...source }) => ({ ...source, progress: event_progress && (!source.progress || instantKey(event_progress.observed_at) > instantKey(source.progress.observed_at)) ? event_progress : source.progress }));
  const { rows: [totals] } = await client.query(`SELECT COALESCE((SELECT count(*) FROM annotations a JOIN book_sources bs ON bs.source_id = a.source_id WHERE bs.book_id = $1 AND NOT a.archived),0) AS active_annotations,
    COALESCE((SELECT count(*) FROM annotations a JOIN book_sources bs ON bs.source_id = a.source_id WHERE bs.book_id = $1 AND a.archived),0) AS archived_annotations,
    (SELECT e.content->>'occurred_at' FROM events e JOIN book_sources bs ON bs.source_id = e.source_id WHERE bs.book_id = $1 ORDER BY ${eventKey}, e.event_id LIMIT 1) AS first_tracked_at,
    (SELECT e.content->>'occurred_at' FROM events e JOIN book_sources bs ON bs.source_id = e.source_id WHERE bs.book_id = $1 ORDER BY ${eventKey} DESC, e.event_id DESC LIMIT 1) AS last_tracked_at,
    (SELECT count(DISTINCT active.day) FROM (
      SELECT e.content->>'volume_date' AS day FROM events e JOIN book_sources bs ON bs.source_id = e.source_id
        WHERE bs.book_id = $1 AND e.content->>'type' = 'reading_segment' AND e.content->>'volume_quality' = 'measured' AND (e.content->>'credited_characters')::numeric > 0
          AND e.content->>'volume_date' <= (CURRENT_TIMESTAMP AT TIME ZONE (SELECT reporting_timezone FROM instance WHERE singleton = TRUE))::date::text
      UNION ALL SELECT allocation->>'date' FROM events e JOIN book_sources bs ON bs.source_id = e.source_id
        CROSS JOIN LATERAL jsonb_array_elements(e.content->'allocation') allocation
        WHERE bs.book_id = $1 AND e.content->>'type' = 'reading_segment' AND (allocation->>'seconds')::numeric > 0
          AND allocation->>'date' <= (CURRENT_TIMESTAMP AT TIME ZONE (SELECT reporting_timezone FROM instance WHERE singleton = TRUE))::date::text
    ) active) AS active_days`, [id]);
  const opened = sources.filter(source => source.last_opened_at !== null).sort((a, b) => instantKey(b.last_opened_at).localeCompare(instantKey(a.last_opened_at)) || a.source_id.localeCompare(b.source_id));
  const recent = opened[0] ?? null, primary = recent ?? sources[0];
  const result = { book_id: book.book_id, title: book.title, authors: primary.authors, sources, active_annotations: Number(totals.active_annotations), archived_annotations: Number(totals.archived_annotations), most_recent_source_id: recent?.source_id ?? null, first_tracked_at: totals.first_tracked_at, last_tracked_at: totals.last_tracked_at, active_days: Number(totals.active_days) };
  if (Buffer.byteLength(JSON.stringify(result)) > budget) fail(413, 'item_too_large');
  return result;
}
export async function bookDetail(db, id) {
  return db.withTransaction(async client => {
    await client.query('SELECT instance_id FROM instance WHERE singleton = TRUE FOR UPDATE');
    return readBook(client, id);
  });
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export async function listBooks(db, raw) {
  const request = { ...raw };
  if (Object.keys(request).some(key => !['cursor', 'limit', 'byte_budget', 'search'].includes(key))) fail(400, 'invalid_request');
  for (const key of ['limit', 'byte_budget']) if (request[key] !== undefined) {
    if (typeof request[key] !== 'string' || !/^[1-9][0-9]*$/.test(request[key])) fail(400, 'invalid_request');
    request[key] = Number(request[key]);
  }
  if (!validate('list_query', request)) fail(400, 'invalid_request');
  const search = request.search ?? '', limit = request.limit ?? 50, budget = request.byte_budget ?? 262144;
  let after = null;
  if (request.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(request.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 2 || cursor[0] !== search || !uuid(cursor[1]) || encode(cursor) !== request.cursor) throw new Error();
      after = cursor[1];
    } catch { fail(400, 'invalid_cursor'); }
  }
  return db.withTransaction(async client => {
    await client.query('SELECT instance_id FROM instance WHERE singleton = TRUE FOR UPDATE');
    const { rows } = await client.query(`SELECT b.book_id FROM books b WHERE ($1 = '' OR position(lower($1) IN lower(b.title)) > 0)
      AND ($2::uuid IS NULL OR b.book_id > $2::uuid) AND EXISTS (SELECT 1 FROM book_sources bs WHERE bs.book_id = b.book_id)
      ORDER BY b.book_id LIMIT $3`, [search, after, limit + 1]);
    const items = [];
    for (let i = 0; i < Math.min(rows.length, limit); i++) {
      let item;
      try { item = await readBook(client, rows[i].book_id, budget); }
      catch (error) { if (error instanceof SyncError && error.status === 413 && items.length) break; throw error; }
      items.push(item);
      if (Buffer.byteLength(JSON.stringify({ items, next_cursor: null })) > budget) { items.pop(); break; }
    }
    while (true) {
      const next = items.length < rows.length && items.length ? encode([search, items.at(-1).book_id]) : null;
      const result = { items, next_cursor: next };
      if (Buffer.byteLength(JSON.stringify(result)) <= budget && (items.length || rows.length === 0)) return result;
      if (items.length <= 1) fail(413, 'item_too_large');
      items.pop();
    }
  });
}

export async function listSources(db, id, raw) {
  if (!uuid(id)) fail(400, 'invalid_id');
  id = id.toLowerCase();
  const request = { ...raw };
  if (Object.keys(request).some(key => !['cursor', 'limit', 'byte_budget'].includes(key))) fail(400, 'invalid_request');
  for (const key of ['limit', 'byte_budget']) if (request[key] !== undefined) {
    if (typeof request[key] !== 'string' || !/^[1-9][0-9]*$/.test(request[key])) fail(400, 'invalid_request');
    request[key] = Number(request[key]);
  }
  if (!validate('list_query', request)) fail(400, 'invalid_request');
  let after = '';
  if (request.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'));
      if (!Array.isArray(cursor) || cursor.length !== 2 || cursor[0] !== id || !/^[0-9a-f]{64}$/.test(cursor[1]) || encode(cursor) !== request.cursor) throw new Error();
      after = cursor[1];
    } catch { fail(400, 'invalid_cursor'); }
  }
  const limit = request.limit ?? 50, budget = request.byte_budget ?? 262144;
  return db.withTransaction(async client => {
    await client.query('SELECT instance_id FROM instance WHERE singleton = TRUE FOR UPDATE');
    if (!(await client.query('SELECT book_id FROM books WHERE book_id = $1', [id])).rows.length) fail(404, 'book_not_found');
    const size = `octet_length(s.metadata->>'title') + COALESCE((SELECT sum(octet_length(a) + 2) FROM jsonb_array_elements_text(s.metadata->'authors') a), 0)
      + COALESCE(octet_length(chosen.progress->'position'->>'value'), 0) + COALESCE(octet_length(chosen.progress->'position'->>'geometry_version'), 0)
      + COALESCE(jsonb_array_length(chosen.progress->'position'->'boxes'), 0) * 20`;
    const { rows } = await client.query(`SELECT s.source_id, s.format, CASE WHEN ${size} > $4 THEN NULL ELSE s.metadata->>'title' END AS title,
      CASE WHEN ${size} > $4 THEN NULL ELSE s.metadata->'authors' END AS authors, CASE WHEN ${size} > $4 THEN NULL ELSE chosen.progress END AS progress,
      ${size} > $4 AS too_large, s.cover IS NOT NULL AS cover_available,
      (SELECT e.content->>'occurred_at' FROM events e WHERE e.source_id = s.source_id AND e.content->>'type' = 'session_started'
        ORDER BY ${eventKey} DESC, e.event_id DESC LIMIT 1) AS last_opened_at
      FROM sources s JOIN book_sources bs ON bs.source_id = s.source_id ${sampleJoin} ${chosenJoin}
      WHERE bs.book_id = $1 AND s.source_id > $2 ORDER BY s.source_id LIMIT $3`, [id, after, limit + 1, budget]);
    const mapped = rows.map(({ too_large, event_progress, ...source }) => source);
    const complete = { items: mapped, next_cursor: null };
    if (mapped.length <= limit && !rows.some(row => row.too_large) && Buffer.byteLength(JSON.stringify(complete)) <= budget) return complete;
    const items = [];
    for (let i = 0; i < Math.min(limit, mapped.length); i++) {
      if (rows[i].too_large) {
        if (!items.length) fail(413, 'item_too_large');
        return { items, next_cursor: encode([id, mapped[i - 1].source_id]) };
      }
      items.push(mapped[i]);
      const next = i + 1 < mapped.length ? encode([id, mapped[i].source_id]) : null;
      if (Buffer.byteLength(JSON.stringify({ items, next_cursor: next })) > budget) {
        items.pop();
        if (!items.length) fail(413, 'item_too_large');
        return { items, next_cursor: encode([id, mapped[i - 1].source_id]) };
      }
    }
    const result = { items, next_cursor: items.length < mapped.length ? encode([id, mapped[items.length - 1].source_id]) : null };
    if (Buffer.byteLength(JSON.stringify(result)) > budget) fail(413, 'item_too_large');
    return result;
  });
}
