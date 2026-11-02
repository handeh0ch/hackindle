import { validate } from '../contracts/validate.js';
import { SyncError } from './sync.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const displayTimestamp = value => value.slice(0, 10) + 'T' + value.slice(11, 19) + (value[19] === '.' ? '.' + value.slice(20, 23).replace(/Z$/, '') : '') + 'Z';
function decode(value) {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Object.keys(decoded).sort().join(',') !== 'field,id,offset,version' || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0 || !Number.isSafeInteger(decoded.version)) throw new Error();
    return decoded;
  } catch { fail(400, 'invalid_cursor'); }
}
export function createContentService(db) {
  async function get(id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail(400, 'invalid_id');
    const { rows: [row] } = await db.query('SELECT annotation_id, source_id, version, archived, content FROM annotations WHERE annotation_id = $1', [id]);
    if (!row) fail(404, 'annotation_not_found');
    return row;
  }
  return {
    async detail(id) {
      const row = await get(id), c = row.content.context;
      return { annotation_id: row.annotation_id, source_id: row.source_id, version: Number(row.version), kind: row.content.kind, archived: row.archived, context_status: c?.status ?? 'none', context_origin: c?.origin ?? null, context_captured_at: c?.captured_at == null ? null : displayTimestamp(c.captured_at), context_page_basis: c?.page_basis ?? null, context_total_pages: c?.total_pages ?? null, context_reason: c?.reason == null ? null : Array.from(c.reason).slice(0, 500).join('') };
    },
    async content(id, request) {
      if (!validate('content_query', request)) fail(400, 'invalid_request');
      const row = await get(id), version = Number(row.version), cursor = request.cursor ? decode(request.cursor) : null;
      if (cursor && (cursor.id !== id || cursor.field !== request.field)) fail(400, 'invalid_cursor');
      if ((cursor && cursor.version !== version) || (request.version !== undefined && request.version !== version)) fail(409, 'content_changed');
      const value = request.field === 'context' ? JSON.stringify(row.content.context) : row.content[request.field];
      const chars = Array.from(value), offset = cursor?.offset ?? 0;
      if (offset > chars.length) fail(400, 'invalid_cursor');
      const response = end => ({ annotation_id: id, version, field: request.field, text: chars.slice(offset, end).join(''), next_cursor: end < chars.length ? encode({ id, version, field: request.field, offset: end }) : null });
      if (Buffer.byteLength(JSON.stringify(response(chars.length))) <= 262144) return response(chars.length);
      let low = offset, high = chars.length;
      while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2);
        if (Buffer.byteLength(JSON.stringify(response(mid))) <= 262144) low = mid; else high = mid;
      }
      if (low === offset) fail(413, 'content_too_large');
      return response(low);
    },
  };
}
