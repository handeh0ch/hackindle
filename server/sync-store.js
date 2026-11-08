import { randomUUID } from 'node:crypto';
import { canonicalDigest } from '../contracts/validate.js';
import { SyncError } from './sync.js';
import { legacyUpdate } from './legacy.js';
import { vocabularyIdentity } from './vocabulary-identity.js';
import { UNICODE_VERSION } from './unicode-lower.js';
const bodyDigest = annotation => { const { context, ...body } = annotation; return canonicalDigest({ ...body, annotation_id: body.annotation_id.toLowerCase() }); };
export function createSyncTx(client) {
  const query = (sql, args) => client.query(sql, args);
  return {
    async lock() { const { rows: [row] } = await query('SELECT instance_id, reset_generation, reporting_timezone FROM instance WHERE singleton = TRUE FOR UPDATE'); return row; },
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
    async metadata(id, value, generation) {
      await query('INSERT INTO sources (source_id, format, metadata, reset_generation) VALUES ($1,$2,$3,$4) ON CONFLICT (source_id) DO UPDATE SET metadata = EXCLUDED.metadata, reset_generation = EXCLUDED.reset_generation', [id, value.format, JSON.stringify(value), generation]);
      const { rows } = await query('SELECT book_id FROM book_sources WHERE source_id = $1', [id]);
      if (!rows.length) {
        const book = randomUUID();
        await query('INSERT INTO books (book_id, title) VALUES ($1,$2)', [book, value.title]);
        await query('INSERT INTO book_sources (source_id, book_id) VALUES ($1,$2)', [id, book]);
      }
    },
    async splitSources(bookId, sourceIds) {
      const { rows: [book] } = await query('SELECT book_id, title FROM books WHERE book_id = $1 FOR UPDATE', [bookId]);
      if (!book) throw new SyncError(404, 'book_not_found');
      const { rows } = await query('SELECT source_id FROM book_sources WHERE book_id = $1 FOR UPDATE', [bookId]);
      const current = new Set(rows.map(row => row.source_id));
      if (sourceIds.some(id => !current.has(id))) throw new SyncError(409, 'source_not_in_book');
      if (sourceIds.length === 0 || sourceIds.length === current.size) throw new SyncError(409, 'nothing_to_split');
      const created = randomUUID();
      await query('INSERT INTO books (book_id, title) VALUES ($1,$2)', [created, book.title]);
      await query('UPDATE book_sources SET book_id = $2 WHERE source_id = ANY($1::text[]) AND book_id = $3', [sourceIds, created, bookId]);
      return { original: bookId, created };
    },
    async mergeSources(target, sourceIds) {
      const { rows: [book] } = await query('SELECT book_id FROM books WHERE book_id = $1 FOR UPDATE', [target]);
      if (!book) throw new SyncError(404, 'book_not_found');
      const { rows } = await query('SELECT source_id, book_id FROM book_sources WHERE source_id = ANY($1::text[]) FOR UPDATE', [sourceIds]);
      if (rows.length !== sourceIds.length) throw new SyncError(404, 'source_not_found');
      const previous = [...new Set(rows.map(row => row.book_id).filter(id => id !== target))];
      await query('UPDATE book_sources SET book_id = $2 WHERE source_id = ANY($1::text[])', [sourceIds, target]);
      await query('DELETE FROM books WHERE book_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM book_sources WHERE book_id = books.book_id)', [previous]);
      return target;
    },
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
    async vocabularyUnicode() {
      const { rows } = await query("SELECT entity_id FROM reset_tombstones WHERE reset_generation = 0 AND entity_type = 'unicode_version'");
      if (rows.length > 1) throw new SyncError(409, 'unicode_version_unknown');
      if (rows.length) return { version: rows[0].entity_id, unknown: false };
      const previous = await query("SELECT 1 FROM reset_tombstones WHERE entity_type IN ('vocabulary', 'vocabulary_identity') LIMIT 1");
      return { version: null, unknown: previous.rows.length > 0 };
    },
    async rememberVocabularyUnicode(version) {
      await query("INSERT INTO reset_tombstones (reset_generation, entity_type, entity_id) VALUES (0, 'unicode_version', $1)", [version]);
    },
    async vocabulary(words) {
      await query('DELETE FROM vocabulary');
      const keys = words.map(word => canonicalDigest(word));
      const identities = words.map(word => canonicalDigest(vocabularyIdentity(word)));
      await query("UPDATE reset_tombstones SET digest = entity_id WHERE entity_type = 'vocabulary' AND NOT (entity_id = ANY($1::text[]))", [keys]);
      await query("UPDATE reset_tombstones SET digest = entity_id WHERE entity_type = 'vocabulary_identity' AND NOT (entity_id = ANY($1::text[]))", [identities]);
      for (const word of words) {
        const key = canonicalDigest(word);
        const { rows } = await query("SELECT 1 FROM reset_tombstones WHERE ((entity_type = 'vocabulary_identity' AND entity_id = $1) OR (entity_type = 'vocabulary' AND entity_id = $2)) AND digest IS NULL LIMIT 1", [canonicalDigest(vocabularyIdentity(word)), key]);
        if (!rows.length) await query('INSERT INTO vocabulary (word_key, content) VALUES ($1,$2) ON CONFLICT (word_key) DO NOTHING', [key, JSON.stringify(word)]);
      }
    },
    async legacyBaseline(device, source, generation) {
      const { rows: [row] } = await query('SELECT baseline_id, native_epoch, digest FROM legacy_handshakes WHERE device_id = $1 AND source_id = $2 AND reset_generation = $3', [device, source, generation]);
      return row;
    },
    async establishLegacyBaseline(device, source, generation, id, digest, records, epoch) {
      const { rows: [lineage] } = await query('SELECT native_epoch FROM legacy_lineages WHERE source_id = $1', [source]);
      if (lineage && lineage.native_epoch.toLowerCase() !== epoch) throw new SyncError(409, 'legacy_epoch_conflict');
      if (!lineage) {
        // Untagged historical high-water is only a conservative exclusion floor;
        // it does not establish that the old and new native epochs match.
        await query('INSERT INTO legacy_lineages (source_id, native_epoch) VALUES ($1,$2)', [source, epoch]);
      }
      if (generation === 0) await this.legacy(source, records, false);
      else for (const record of records) {
        const args = [source, record.date];
        const { rows: [old] } = await query('SELECT native_pages, native_seconds FROM legacy_raw_highwater WHERE source_id = $1 AND reporting_date = $2', args);
        const pages = Math.max(Number(old?.native_pages ?? 0), record.native_pages);
        const seconds = Math.max(Number(old?.native_seconds ?? 0), record.native_seconds);
        await query('INSERT INTO legacy_raw_highwater (source_id, reporting_date, native_pages, native_seconds) VALUES ($1,$2,$3,$4) ON CONFLICT (source_id, reporting_date) DO UPDATE SET native_pages = EXCLUDED.native_pages, native_seconds = EXCLUDED.native_seconds', [...args, pages, seconds]);
        await query('INSERT INTO legacy_reset_baseline (source_id, reporting_date, native_pages, native_seconds) VALUES ($1,$2,$3,$4) ON CONFLICT (source_id, reporting_date) DO UPDATE SET native_pages = EXCLUDED.native_pages, native_seconds = EXCLUDED.native_seconds', [...args, pages, seconds]);
      }
      await query('INSERT INTO legacy_handshakes (device_id, source_id, reset_generation, baseline_id, native_epoch, digest) VALUES ($1,$2,$3,$4,$5,$6)', [device, source, generation, id, epoch, digest]);
    },
    async legacy(source, records, rejectRegression = true) {
      for (const record of records) {
        const args = [source, record.date];
        const rawRow = (await query('SELECT native_pages, native_seconds FROM legacy_raw_highwater WHERE source_id = $1 AND reporting_date = $2', args)).rows[0];
        const baseRow = (await query('SELECT native_pages, native_seconds FROM legacy_reset_baseline WHERE source_id = $1 AND reporting_date = $2', args)).rows[0];
        const liveRow = (await query('SELECT native_pages, native_seconds FROM legacy_statistics WHERE source_id = $1 AND reporting_date = $2', args)).rows[0];
        const pair = row => ({ pages: Number(row?.native_pages ?? 0), seconds: Number(row?.native_seconds ?? 0) });
        if (rejectRegression && rawRow && (record.native_pages < Number(rawRow.native_pages) || record.native_seconds < Number(rawRow.native_seconds))) throw new SyncError(409, 'legacy_counter_regressed');
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
    async findOpen(manifest) {
      const { rows } = await query('SELECT upload_id, manifest, expires_at FROM uploads WHERE device_id = $1 AND source_id IS NOT DISTINCT FROM $2 AND seq = $3 AND reset_generation = $4 AND committed_ack IS NULL ORDER BY expires_at', [manifest.device_id, manifest.source_id, manifest.seq, manifest.reset_generation]);
      return rows.map(row => ({ upload_id: row.upload_id, manifest: row.manifest, expires: row.expires_at }));
    },
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
      const unicode = await this.vocabularyUnicode();
      if (unicode.version && unicode.version !== UNICODE_VERSION) throw new SyncError(409, 'unicode_version_mismatch');
      if (!unicode.version && unicode.unknown) throw new SyncError(409, 'unicode_version_unknown');
      const { rows: vocabulary } = await query('SELECT word_key, content FROM vocabulary');
      if (!unicode.version && vocabulary.length) await this.rememberVocabularyUnicode(UNICODE_VERSION);
      await query("INSERT INTO reset_tombstones (reset_generation, entity_type, entity_id) SELECT $1, 'vocabulary', word_key FROM vocabulary ON CONFLICT DO NOTHING", [generation]);
      await query("INSERT INTO reset_tombstones (reset_generation, entity_type, entity_id) SELECT $1, 'vocabulary_identity', unnest($2::text[]) ON CONFLICT DO NOTHING", [generation, vocabulary.map(row => canonicalDigest(vocabularyIdentity(row.content)))]);
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
