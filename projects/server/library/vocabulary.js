import { validate } from '../../../contracts/validate.js';
import { SyncError } from '../sync/sync.js';
import { vocabularyIdentity } from '../text/vocabulary-identity.js';
import { READ_SNAPSHOT } from './read-snapshot.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function parseQuery(raw) {
  const query = { ...raw };
  if (Object.keys(query).some(key => !['cursor', 'limit', 'byte_budget'].includes(key))) fail(400, 'invalid_request');
  for (const key of ['limit', 'byte_budget']) if (query[key] !== undefined) {
    if (typeof query[key] !== 'string' || !/^[1-9][0-9]*$/.test(query[key])) fail(400, 'invalid_request');
    query[key] = Number(query[key]);
  }
  if (!validate('list_query', query)) fail(400, 'invalid_request');
  return { ...query, limit: query.limit ?? 50, byte_budget: query.byte_budget ?? 262144 };
}
function cursorValue(cursor) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 4 || !Number.isSafeInteger(value[0]) || typeof value[1] !== 'string' || !Number.isSafeInteger(value[2]) || !/^[0-9a-f]{64}$/.test(value[3])) throw new Error();
    if (encode(value) !== cursor) throw new Error();
    return value;
  } catch { fail(400, 'invalid_cursor'); }
}
export async function vocabulary(db, raw, countOnly = false) {
  const request = parseQuery(raw), cursor = request.cursor ? cursorValue(request.cursor) : null;
  return db.withTransaction(async client => {
    // countOnly runs inside the statistics snapshot, which already set the isolation level.
    if (!countOnly) await client.query(READ_SNAPSHOT);
    const { rows: [instance] } = await client.query('SELECT instance_id, reset_generation FROM instance WHERE singleton = TRUE');
    const generation = Number(instance.reset_generation);
    const { rows: [snapshot] } = await client.query('SELECT v.device_id, v.version FROM vocabulary_versions v JOIN device d ON d.device_id = v.device_id WHERE d.singleton = TRUE AND v.reset_generation = $1', [generation]);
    if (cursor && (!snapshot || cursor[0] !== generation || cursor[1] !== snapshot.device_id || cursor[2] !== Number(snapshot.version))) fail(400, 'invalid_cursor');
    let result;
    if (!snapshot) result = { status: 'unavailable', count: null, items: [], next_cursor: null };
    else {
      const seen = new Set(), rows = [];
      let after = '';
      while (true) {
        const batch = (await client.query('SELECT word_key, content FROM vocabulary WHERE word_key > $1 ORDER BY word_key LIMIT $2', [after, 256])).rows;
        for (const row of batch) {
          const key = JSON.stringify(vocabularyIdentity(row.content));
          if (!seen.has(key)) {
            seen.add(key);
            if (row.word_key > (cursor?.[3] ?? '') && rows.length <= request.limit) rows.push(row);
          }
        }
        if (batch.length < 256) break;
        after = batch.at(-1).word_key;
      }
      if (countOnly) return { count: seen.size };
      const items = [];
      const response = (next = null) => ({ status: 'available', count: seen.size, items, next_cursor: next });
      result = response();
      const complete = response();
      complete.items = rows.map(row => row.content);
      if (rows.length <= request.limit && Buffer.byteLength(JSON.stringify(complete)) <= request.byte_budget) return complete;
      for (let i = 0; i < Math.min(request.limit, rows.length); i++) {
        items.push(rows[i].content);
        const next = i + 1 < rows.length ? encode([generation, snapshot.device_id, Number(snapshot.version), rows[i].word_key]) : null;
        const candidate = response(next);
        if (Buffer.byteLength(JSON.stringify(candidate)) > request.byte_budget) {
          items.pop();
          if (!items.length) fail(413, 'item_too_large');
          result = response(encode([generation, snapshot.device_id, Number(snapshot.version), rows[i - 1].word_key]));
          break;
        }
        result = candidate;
      }
    }
    if (Buffer.byteLength(JSON.stringify(result)) > request.byte_budget) fail(413, 'item_too_large');
    return result;
  });
}
