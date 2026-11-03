import { SyncError } from './sync.js';
export function safeTotal(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new SyncError(422, 'totals_overflow');
  return result;
}
