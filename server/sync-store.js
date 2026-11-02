import { canonicalDigest } from '../contracts/validate.js';
import { SyncError } from './sync.js';
import { legacyUpdate } from './legacy.js';
const bodyDigest = annotation => { const { context, ...body } = annotation; return canonicalDigest({ ...body, annotation_id: body.annotation_id.toLowerCase() }); };
export function createSyncTx(client) {
  const query = (sql, args) => client.query(sql, args);
  return {
    async lock() { const { rows: [row] } = await query('SELECT instance_id, reset_generation FROM instance WHERE singleton = TRUE FOR UPDATE'); return row; },
    async device(hash) { const { rows: [row] } = await query('SELECT device_id FROM device WHERE token_hash = $1 FOR UPDATE', [hash]); return row; },
    async bind(hash, id) { const { rows } = await query('UPDATE device SET device_id = COALESCE(device_id, $2) WHERE token_hash = $1 AND (device_id IS NULL OR device_id = $2) RETURNING device_id', [hash, id]); return rows.length === 1; },
    async packet(device, seq) { const { rows: [row] } = await query('SELECT digest, acknowledgement AS ack FROM packets WHERE device_id = $1 AND seq = $2', [device, seq]); return row; },
    async savePacket(e, digest, ack) { await query('INSERT INTO packets (device_id, seq, reset_generation, digest, acknowledgement) VALUES ($1,$2,$3,$4,$5)', [e.device_id, e.seq, e.reset_generation, digest, JSON.stringify(ack)]); },
    async source(id) { const { rows: [row] } = await query('SELECT metadata FROM sources WHERE source_id = $1', [id]); return row?.metadata; },
    async section(key) {
      const [device, source, name, generation] = JSON.parse(key);
      const result = name === 'vocabulary_snapshot' ? await query('SELECT version, digest FROM vocabulary_versions WHERE device_id = $1 AND reset_generation = $2', [device, generation]) : await query('SELECT version, digest FROM snapshot_versions WHERE device_id = $1 AND source_id = $2 AND section = $3 AND reset_generation = $4', [device, source, name, generation]);
      return result.rows[0];
    },
    async saveSection(key, version, digest) {
      const [device, source, name, generation] = JSON.parse(key);
      if (name === 'vocabulary_snapshot') await query('INSERT INTO vocabulary_versions (device_id, reset_generation, version, digest) VALUES ($1,$2,$3,$4) ON CONFLICT (device_id, reset_generation) DO UPDATE SET version = EXCLUDED.version, digest = EXCLUDED.digest', [device, generation, version, digest]);
      else await query('INSERT INTO snapshot_versions (device_id, source_id, section, reset_generation, version, digest) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (device_id, source_id, section, reset_generation) DO UPDATE SET version = EXCLUDED.version, digest = EXCLUDED.digest', [device, source, name, generation, version, digest]);
    },
    async metadata(id, value, generation) { await query('INSERT INTO sources (source_id, format, metadata, reset_generation) VALUES ($1,$2,$3,$4) ON CONFLICT (source_id) DO UPDATE SET metadata = EXCLUDED.metadata, reset_generation = EXCLUDED.reset_generation', [id, value.format, JSON.stringify(value), generation]); },
    async progress(id, value) { await query('UPDATE sources SET progress = $2 WHERE source_id = $1', [id, JSON.stringify(value)]); },
    async annotations(source, annotations) {
      const { rows: current } = await query('SELECT annotation_id, version, archived, content FROM annotations WHERE source_id = $1', [source]);
      const byId = new Map(current.map(row => [row.annotation_id.toLowerCase(), row])), seen = new Set();
      for (const annotation of annotations) {
        const id = annotation.annotation_id, digest = bodyDigest(annotation);
        const { rows: [identity] } = await query('SELECT source_id, digest, barrier_generation, content_version FROM annotation_identities WHERE annotation_id = $1', [id]);
        if (identity && identity.source_id !== source) throw new SyncError(409, 'annotation_id_conflict');
        seen.add(id.toLowerCase());
        if (identity?.barrier_generation !== null && identity?.barrier_generation !== undefined && identity.digest === digest) continue;
        const old = byId.get(id.toLowerCase());
        const sameSelection = old && canonicalDigest([old.content.start, old.content.end]) === canonicalDigest([annotation.start, annotation.end]);
        const content = sameSelection && old.content.context?.status === 'ready' ? { ...annotation, context: old.content.context } : annotation;
        if (old && !old.archived && canonicalDigest(old.content) === canonicalDigest(content)) continue;
        const version = Number(identity?.content_version ?? 0) + 1;
        await query('INSERT INTO annotation_identities (annotation_id, source_id, digest, barrier_generation, content_version) VALUES ($1,$2,$3,NULL,$4) ON CONFLICT (annotation_id) DO UPDATE SET digest = EXCLUDED.digest, barrier_generation = NULL, content_version = EXCLUDED.content_version', [id, source, digest, version]);
        await query('INSERT INTO annotations (source_id, annotation_id, version, archived, content) VALUES ($1,$2,$3,FALSE,$4) ON CONFLICT (source_id, annotation_id) DO UPDATE SET version = EXCLUDED.version, archived = FALSE, content = EXCLUDED.content', [source, id, version, JSON.stringify(content)]);
        await query('INSERT INTO annotation_versions (source_id, annotation_id, version, content) VALUES ($1,$2,$3,$4)', [source, id, version, JSON.stringify(content)]);
      }
      for (const row of current) {
        if (!row.archived && !seen.has(row.annotation_id.toLowerCase())) {
          const version = Number(row.version) + 1;
          await query('UPDATE annotation_identities SET content_version = $2 WHERE annotation_id = $1', [row.annotation_id, version]);
          await query('UPDATE annotations SET archived = TRUE, version = $3 WHERE source_id = $1 AND annotation_id = $2', [source, row.annotation_id, version]);
          await query('INSERT INTO annotation_versions (source_id, annotation_id, version, content) VALUES ($1,$2,$3,$4)', [source, row.annotation_id, version, JSON.stringify(row.content)]);
        }
      }
    },
    async event(id) { const { rows: [row] } = await query('SELECT digest FROM event_identities WHERE event_id = $1', [id]); return row; },
    async saveEvent(event, digest, envelope, generation) {
      await query('INSERT INTO event_identities (event_id, digest) VALUES ($1,$2)', [event.event_id, digest]);
      await query('INSERT INTO events (event_id, device_id, source_id, reset_generation, digest, content) VALUES ($1,$2,$3,$4,$5,$6)', [event.event_id, envelope.device_id, envelope.source_id, generation, digest, JSON.stringify(event)]);
    },
    async vocabulary(words) {
      await query('DELETE FROM vocabulary');
      for (const word of words) {
        const key = canonicalDigest(word);
        const { rows } = await query("SELECT 1 FROM reset_tombstones WHERE entity_type = 'vocabulary' AND entity_id = $1 LIMIT 1", [key]);
        if (!rows.length) await query('INSERT INTO vocabulary (word_key, content) VALUES ($1,$2) ON CONFLICT (word_key) DO NOTHING', [key, JSON.stringify(word)]);
      }
    },
    async legacy(source, records) {
      for (const record of records) {
        const args = [source, record.date];
        const rawRow = (await query('SELECT native_pages, native_seconds FROM legacy_raw_highwater WHERE source_id = $1 AND reporting_date = $2', args)).rows[0];
        const baseRow = (await query('SELECT native_pages, native_seconds FROM legacy_reset_baseline WHERE source_id = $1 AND reporting_date = $2', args)).rows[0];
        const liveRow = (await query('SELECT native_pages, native_seconds FROM legacy_statistics WHERE source_id = $1 AND reporting_date = $2', args)).rows[0];
        const pair = row => ({ pages: Number(row?.native_pages ?? 0), seconds: Number(row?.native_seconds ?? 0) });
        const updated = legacyUpdate({ pages: record.native_pages, seconds: record.native_seconds }, pair(rawRow), pair(baseRow), pair(liveRow));
        await query('INSERT INTO legacy_raw_highwater (source_id, reporting_date, native_pages, native_seconds) VALUES ($1,$2,$3,$4) ON CONFLICT (source_id, reporting_date) DO UPDATE SET native_pages = EXCLUDED.native_pages, native_seconds = EXCLUDED.native_seconds', [...args, updated.raw.pages, updated.raw.seconds]);
        await query('INSERT INTO legacy_statistics (source_id, reporting_date, native_pages, native_seconds) VALUES ($1,$2,$3,$4) ON CONFLICT (source_id, reporting_date) DO UPDATE SET native_pages = EXCLUDED.native_pages, native_seconds = EXCLUDED.native_seconds', [...args, updated.live.pages, updated.live.seconds]);
      }
    },
    async prune(at) {
      await query("INSERT INTO reset_tombstones (reset_generation, entity_type, entity_id) SELECT (SELECT reset_generation FROM instance WHERE singleton = TRUE), 'upload', upload_id::text FROM uploads WHERE expires_at <= $1 ON CONFLICT DO NOTHING", [new Date(at)]);
      await query('DELETE FROM uploads WHERE expires_at <= $1', [new Date(at)]);
    },
    async countOpen(device) { const { rows: [row] } = await query('SELECT count(*) AS count FROM uploads WHERE device_id = $1 AND committed_ack IS NULL', [device]); return Number(row.count); },
    async insertUpload(id, manifest, expires) { await query('INSERT INTO uploads (upload_id, device_id, source_id, seq, reset_generation, manifest, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, manifest.device_id, manifest.source_id, manifest.seq, manifest.reset_generation, JSON.stringify(manifest), new Date(expires)]); },
    async upload(id) {
      const { rows: [row] } = await query('SELECT manifest, expires_at, committed_ack FROM uploads WHERE upload_id = $1', [id]);
      if (row) return { manifest: row.manifest, expires: row.expires_at, ack: row.committed_ack };
      const { rows } = await query("SELECT 1 FROM reset_tombstones WHERE entity_type = 'upload' AND entity_id = $1 LIMIT 1", [id]);
      return rows.length ? { gone: true } : null;
    },
    async chunk(id, index) { const { rows: [row] } = await query('SELECT digest FROM upload_chunks WHERE upload_id = $1 AND chunk_index = $2', [id, index]); return row; },
    async chunkBytes(id) { const { rows: [row] } = await query('SELECT COALESCE(sum(octet_length(content)), 0) AS bytes FROM upload_chunks WHERE upload_id = $1', [id]); return Number(row.bytes); },
    async insertChunk(id, index, digest, bytes) { await query('INSERT INTO upload_chunks (upload_id, chunk_index, digest, content) VALUES ($1,$2,$3,$4)', [id, index, digest, bytes]); },
    async assemble(id) {
      const { rows: [row] } = await query('SELECT count(*) AS count, min(chunk_index) AS min, max(chunk_index) AS max, COALESCE(string_agg(content, $2::bytea ORDER BY chunk_index), $2::bytea) AS bytes FROM upload_chunks WHERE upload_id = $1', [id, Buffer.alloc(0)]);
      return { count: Number(row.count), min: row.min, max: row.max, bytes: row.bytes };
    },
    async completeUpload(id, ack) { await query('UPDATE uploads SET committed_ack = $2 WHERE upload_id = $1', [id, JSON.stringify(ack)]); },
    async coverSource(id) { const { rows: [row] } = await query('SELECT reset_generation FROM sources WHERE source_id = $1', [id]); return row; },
    async saveCover(id, type, bytes) { await query('UPDATE sources SET cover_type = $2, cover = $3 WHERE source_id = $1', [id, type, bytes]); },
    async clear(generation) {
      await query("INSERT INTO reset_tombstones (reset_generation, entity_type, entity_id) SELECT $1, 'vocabulary', word_key FROM vocabulary ON CONFLICT DO NOTHING", [generation]);
      await query("INSERT INTO reset_tombstones (reset_generation, entity_type, entity_id) SELECT $1, 'upload', upload_id::text FROM uploads ON CONFLICT DO NOTHING", [generation]);
      await query('UPDATE annotation_identities SET barrier_generation = $1', [generation]);
      await query('DELETE FROM legacy_reset_baseline');
      await query('INSERT INTO legacy_reset_baseline SELECT source_id, reporting_date, native_pages, native_seconds FROM legacy_raw_highwater');
      for (const table of ['upload_chunks', 'uploads', 'annotation_versions', 'annotations', 'events', 'book_sources', 'legacy_statistics', 'vocabulary', 'snapshot_versions', 'vocabulary_versions', 'sources', 'books', 'goals']) await query(`DELETE FROM ${table}`);
      await query('UPDATE device SET last_sync_at = NULL WHERE singleton = TRUE');
      await query('UPDATE instance SET reset_generation = $1 WHERE singleton = TRUE', [generation]);
    },
    async touch() { await query('UPDATE device SET last_sync_at = now() WHERE singleton = TRUE'); },
  };
}
