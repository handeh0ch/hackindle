import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoverService } from '../../projects/server/sync/cover.js';
const source = 'a'.repeat(64), device = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
test('cover requires bound device, current generation, existing source and genuine signature', async () => {
  let saved;
  const tx = { lock: async () => ({ reset_generation: 2 }), device: async () => ({ device_id: device }), coverSource: async id => id === source ? { reset_generation: 2 } : null, saveCover: async (id, type, bytes) => { saved = { id, type, bytes }; } };
  const service = createCoverService({ db: { withTransaction: async fn => fn(tx) }, createTx: x => x });
  const bytes = Buffer.from([255, 216, 255, 0, 255, 217]);
  await service.put('token', device, 2, source, 'image/jpeg', bytes); assert.equal(saved.type, 'image/jpeg');
  await assert.rejects(service.put('token', device, 1, source, 'image/jpeg', bytes), error => error.status === 409);
  await assert.rejects(service.put('token', device, 2, source, 'image/jpeg', Buffer.from('bad')), error => error.status === 400);
  await assert.rejects(service.put('token', device, 2, 'b'.repeat(64), 'image/jpeg', bytes), error => error.status === 404);
});
test('cover validates WebP structure, size, device binding and private reads', async () => {
  const webp = Buffer.alloc(12); webp.write('RIFF', 0); webp.writeUInt32LE(4, 4); webp.write('WEBP', 8);
  const tx = { lock: async () => ({ reset_generation: 1 }), device: async hash => hash === 'missing' ? null : { device_id: device }, coverSource: async () => ({ reset_generation: 1 }), saveCover: async () => {} };
  const db = { withTransaction: async work => work(tx), query: async id => ({ rows: [{ cover: webp, cover_type: 'image/webp' }] }) };
  const service = createCoverService({ db, createTx: client => client });
  await service.put('token', device.toUpperCase(), 1, source, 'image/webp', webp);
  assert.equal((await service.get(source)).type, 'image/webp');
  await assert.rejects(service.put('', device, 1, source, 'image/webp', webp), error => error.status === 401);
  await assert.rejects(service.put('token', device, 1, source, 'image/jpeg', Buffer.alloc(65537)), error => error.status === 413);
  await assert.rejects(service.put('token', device, 1, source, 'image/webp', Buffer.from('RIFFbadWEBP')), error => error.code === 'invalid_cover');
  await assert.rejects(service.put('token', 'bad', 1, source, 'image/webp', webp), error => error.status === 400);
  await assert.rejects(service.put('token', '00000000-0000-4000-8000-000000000001', 1, source, 'image/webp', webp), error => error.status === 403);
  await assert.rejects(service.get('bad'), error => error.status === 400);
  await assert.rejects(createCoverService({ db: { query: async () => ({ rows: [] }) } }).get(source), error => error.status === 404);
});
