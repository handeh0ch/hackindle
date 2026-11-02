import { validate } from '../contracts/validate.js';
import { SyncError } from './sync.js';
export function createResetService({ db, createTx }) {
  return async body => {
    if (!validate('reset_action', body)) throw new SyncError(400, 'invalid_request');
    return db.withTransaction(async client => {
      const tx = createTx(client), row = await tx.lock();
      const generation = Number(row.reset_generation) + 1;
      if (!Number.isSafeInteger(generation)) throw new SyncError(409, 'generation_exhausted');
      await tx.clear(generation);
      return { reset_generation: generation };
    });
  };
}
