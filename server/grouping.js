import { validate } from '../contracts/validate.js';
import { createSyncTx } from './sync-store.js';
import { readBook } from './books.js';
import { SyncError } from './sync.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function mergeBooks(db, action) {
  if (!validate('merge_action', action)) fail(400, 'invalid_request');
  return db.withTransaction(async client => {
    const tx = createSyncTx(client); await tx.lock();
    await tx.mergeSources(action.target_book_id, action.source_ids);
    return readBook(client, action.target_book_id);
  });
}
export async function splitBook(db, bookId, action) {
  if (!uuid(bookId) || !validate('split_action', action)) fail(400, 'invalid_request');
  return db.withTransaction(async client => {
    const tx = createSyncTx(client); await tx.lock();
    const result = await tx.splitSources(bookId, action.source_ids);
    const items = [await readBook(client, result.original), await readBook(client, result.created)];
    const response = { items, next_cursor: null };
    if (Buffer.byteLength(JSON.stringify(response)) > 262144) fail(413, 'item_too_large');
    return response;
  });
}
