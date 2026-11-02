import { createHash } from 'node:crypto';
import { SyncError } from './sync.js';
const fail = (status, code) => { throw new SyncError(status, code); };
const sha = value => createHash('sha256').update(value).digest('hex');
const validSource = id => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);
function validImage(type, bytes) {
  if (type === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  return type === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
}
export function createCoverService({ db, createTx }) {
  return {
    async put(token, deviceId, generation, source, type, bytes) {
      if (typeof token !== 'string' || !token) fail(401, 'unauthorized');
      if (!validSource(source) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId ?? '') || !Number.isSafeInteger(generation) || generation < 0 || !Buffer.isBuffer(bytes)) fail(400, 'invalid_request');
      if (bytes.length > 65536) fail(413, 'cover_too_large');
      if (!validImage(type, bytes)) fail(400, 'invalid_cover');
      return db.withTransaction(async client => {
        const tx = createTx(client), instance = await tx.lock(), bound = await tx.device(sha(token));
        if (!bound) fail(401, 'unauthorized');
        if (!bound.device_id || bound.device_id.toLowerCase() !== deviceId.toLowerCase()) fail(403, 'device_mismatch');
        if (Number(instance.reset_generation) !== generation) fail(409, 'generation_mismatch');
        const record = await tx.coverSource(source);
        if (!record || Number(record.reset_generation) !== generation) fail(404, 'source_not_found');
        await tx.saveCover(source, type, bytes);
      });
    },
    async get(source) {
      if (!validSource(source)) fail(400, 'invalid_source');
      const { rows: [row] } = await db.query('SELECT cover, cover_type FROM sources WHERE source_id = $1', [source]);
      if (!row?.cover) fail(404, 'cover_not_found');
      return { bytes: row.cover, type: row.cover_type };
    },
  };
}
