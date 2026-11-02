import { createHash, randomUUID } from 'node:crypto';
import { validate, validateEnvelope } from '../contracts/validate.js';
import { SyncError } from './sync.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (status, code) => { throw new SyncError(status, code); };
const identityKeys = ['schema_version', 'instance_id', 'device_id', 'source_id', 'reset_generation', 'seq', 'kind'];
export function createUploadService({ db, createTx, apply, now = Date.now, uuid = randomUUID }) {
  async function device(tx, token, deviceId) {
    if (typeof token !== 'string' || !token) fail(401, 'unauthorized');
    const digest = hash(token), bound = await tx.device(digest);
    if (!bound) fail(401, 'unauthorized');
    if (bound.device_id && bound.device_id.toLowerCase() !== deviceId.toLowerCase()) fail(403, 'device_mismatch');
    return digest;
  }
  async function access(tx, token, id) {
    await tx.lock(); await tx.prune(now());
    const upload = await tx.upload(id);
    if (!upload) fail(404, 'upload_not_found');
    if (upload.gone || Number(new Date(upload.expires)) <= now()) fail(410, 'upload_expired');
    if (!validate('manifest', upload.manifest)) fail(400, 'invalid_manifest');
    await device(tx, token, upload.manifest.device_id);
    return upload;
  }
  return {
    async create(token, manifest) {
      if (!validate('manifest', manifest)) fail(400, 'invalid_manifest');
      return db.withTransaction(async client => {
        const tx = createTx(client), instance = await tx.lock();
        if (instance.instance_id.toLowerCase() !== manifest.instance_id.toLowerCase()) fail(403, 'instance_mismatch');
        const digest = await device(tx, token, manifest.device_id), generation = Number(instance.reset_generation);
        if (manifest.reset_generation > generation) fail(409, 'future_generation');
        await tx.prune(now());
        if (await tx.countOpen(manifest.device_id) >= 2) fail(429, 'upload_limit');
        if (manifest.reset_generation === generation && !await tx.bind(digest, manifest.device_id)) fail(403, 'device_mismatch');
        const id = uuid(), expires = now() + 604800000;
        await tx.insertUpload(id, manifest, expires);
        return { upload_id: id, expires_at: new Date(expires).toISOString() };
      });
    },
    async put(token, id, index, bytes) {
      if (!Number.isSafeInteger(index) || index < 0 || !Buffer.isBuffer(bytes) || bytes.length === 0) fail(400, 'invalid_chunk');
      if (bytes.length > 1048576) fail(413, 'chunk_too_large');
      return db.withTransaction(async client => {
        const tx = createTx(client), upload = await access(tx, token, id);
        if (index >= upload.manifest.chunk_count) fail(400, 'invalid_chunk');
        const digest = hash(bytes), old = await tx.chunk(id, index);
        if (old) { if (old.digest !== digest) fail(409, 'chunk_conflict'); return; }
        if (upload.ack) fail(409, 'upload_committed');
        if (await tx.chunkBytes(id) + bytes.length > upload.manifest.byte_length) fail(413, 'upload_too_large');
        await tx.insertChunk(id, index, digest, bytes);
      });
    },
    async commit(token, id) {
      return db.withTransaction(async client => {
        const tx = createTx(client), upload = await access(tx, token, id);
        if (upload.ack) return upload.ack;
        const assembled = await tx.assemble(id), manifest = upload.manifest;
        if (assembled.count !== manifest.chunk_count || assembled.min !== 0 || assembled.max !== manifest.chunk_count - 1 || assembled.bytes.length !== manifest.byte_length) fail(400, 'incomplete_upload');
        if (hash(assembled.bytes) !== manifest.sha256) fail(409, 'upload_hash_mismatch');
        let envelope;
        try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(assembled.bytes)); }
        catch { fail(400, 'invalid_envelope'); }
        if (!validateEnvelope(envelope)) fail(400, 'invalid_envelope');
        if (!identityKeys.every(key => ['instance_id', 'device_id'].includes(key) ? envelope[key].toLowerCase() === manifest[key].toLowerCase() : envelope[key] === manifest[key])) fail(409, 'upload_identity_mismatch');
        const ack = await apply(tx, token, envelope);
        await tx.completeUpload(id, ack);
        return ack;
      });
    },
  };
}
