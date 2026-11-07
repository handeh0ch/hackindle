import { SyncError } from './sync.js';
import { canonicalDigest, validate, validateEnvelope } from '../contracts/validate.js';
import { createHash } from 'node:crypto';
import { validAllocation, validReportingInstant } from './allocation.js';
const tables = {
  books: ['book_id', 'title', 'metadata'],
  sources: ['source_id', 'format', 'metadata', 'cover', 'cover_type', 'reset_generation', 'progress'],
  book_sources: ['source_id', 'book_id'],
  annotations: ['source_id', 'annotation_id', 'version', 'archived', 'content'],
  annotation_versions: ['source_id', 'annotation_id', 'version', 'content'],
  packets: ['device_id', 'seq', 'reset_generation', 'digest', 'acknowledgement'],
  events: ['event_id', 'device_id', 'source_id', 'reset_generation', 'digest', 'content'],
  snapshot_versions: ['device_id', 'source_id', 'section', 'reset_generation', 'version', 'digest'],
  vocabulary_versions: ['device_id', 'reset_generation', 'version', 'digest'],
  vocabulary: ['word_key', 'content'],
  legacy_statistics: ['source_id', 'reporting_date', 'native_pages', 'native_seconds'],
  uploads: ['upload_id', 'device_id', 'source_id', 'seq', 'reset_generation', 'manifest', 'expires_at', 'committed_ack'],
  upload_chunks: ['upload_id', 'chunk_index', 'digest', 'content'],
  goals: ['year', 'target'],
  reset_tombstones: ['reset_generation', 'entity_type', 'entity_id', 'digest'],
  annotation_identities: ['annotation_id', 'source_id', 'digest', 'barrier_generation', 'content_version'],
  event_identities: ['event_id', 'digest'],
  legacy_raw_highwater: ['source_id', 'reporting_date', 'native_pages', 'native_seconds'],
  legacy_reset_baseline: ['source_id', 'reporting_date', 'native_pages', 'native_seconds'],
  legacy_handshakes: ['device_id', 'source_id', 'reset_generation', 'baseline_id', 'native_epoch', 'digest'],
  legacy_lineages: ['source_id', 'native_epoch'],
  match_decisions: ['source_id', 'candidate_book_id', 'decision'],
};
const binary = { sources: 'cover', upload_chunks: 'content' };
export async function exportBackup(db) {
  return db.withTransaction(async client => {
    const { rows: [instance] } = await client.query('SELECT instance_id, reporting_timezone, page_characters, reset_generation FROM instance WHERE singleton = TRUE FOR UPDATE');
    if (!instance) throw new SyncError(409, 'instance_missing');
    const { rows: [device] } = await client.query('SELECT device_id, last_sync_at::text AS last_sync_at FROM device WHERE singleton = TRUE');
    const data = {};
    for (const [table, columns] of Object.entries(tables)) {
      const selection = columns.map(column => ['reporting_date', 'expires_at'].includes(column) ? `${column}::text AS ${column}` : column).join(', ');
      const { rows } = await client.query(`SELECT ${selection} FROM ${table}`);
      data[table] = rows.map(row => binary[table] && row[binary[table]] !== null ? { ...row, [binary[table]]: row[binary[table]].toString('base64') } : row);
    }
    return { format_version: 1, instance, device: device ?? null, tables: data };
  });
}
const fail = (status, code) => { throw new SyncError(status, code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const safeInteger = value => /^(0|[1-9][0-9]*)$/.test(String(value)) && Number.isSafeInteger(Number(value));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const sourceId = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const nullable = { sources: ['cover', 'cover_type', 'progress'], uploads: ['source_id', 'committed_ack'], reset_tombstones: ['digest'], annotation_identities: ['barrier_generation'] };
const primary = { books: ['book_id'], sources: ['source_id'], book_sources: ['source_id'], annotations: ['source_id', 'annotation_id'], annotation_versions: ['source_id', 'annotation_id', 'version'], packets: ['device_id', 'seq'], events: ['event_id'], snapshot_versions: ['device_id', 'source_id', 'section', 'reset_generation'], vocabulary_versions: ['device_id', 'reset_generation'], vocabulary: ['word_key'], legacy_statistics: ['source_id', 'reporting_date'], uploads: ['upload_id'], upload_chunks: ['upload_id', 'chunk_index'], goals: ['year'], reset_tombstones: ['reset_generation', 'entity_type', 'entity_id'], annotation_identities: ['annotation_id'], event_identities: ['event_id'], legacy_raw_highwater: ['source_id', 'reporting_date'], legacy_reset_baseline: ['source_id', 'reporting_date'], legacy_handshakes: ['device_id', 'source_id', 'reset_generation'], legacy_lineages: ['source_id'], match_decisions: ['source_id', 'candidate_book_id'] };
function validateBackup(snapshot, config) {
  if (!exactKeys(snapshot, ['format_version', 'instance', 'device', 'tables']) || snapshot.format_version !== 1 || !exactKeys(snapshot.instance, ['instance_id', 'reporting_timezone', 'page_characters', 'reset_generation']) || !uuid(snapshot.instance.instance_id) || !safeInteger(snapshot.instance.page_characters) || Number(snapshot.instance.page_characters) < 1 || !safeInteger(snapshot.instance.reset_generation)) fail(400, 'invalid_backup');
  if (snapshot.instance.reporting_timezone !== config.reportingTimezone || Number(snapshot.instance.page_characters) !== config.pageCharacters) fail(409, 'policy_mismatch');
  if (snapshot.device !== null && (!exactKeys(snapshot.device, ['device_id', 'last_sync_at']) || (snapshot.device.device_id !== null && !uuid(snapshot.device.device_id)) || (snapshot.device.last_sync_at !== null && (typeof snapshot.device.last_sync_at !== 'string' || !Number.isFinite(Date.parse(snapshot.device.last_sync_at)))))) fail(400, 'invalid_backup');
  if (!exactKeys(snapshot.tables, Object.keys(tables))) fail(400, 'invalid_backup');
  if (!Array.isArray(snapshot.tables.vocabulary) || Buffer.byteLength(JSON.stringify(snapshot.tables.vocabulary.map(row => row?.content))) > 16777216) fail(400, 'invalid_backup');
  const envelope = (kind, source, payload) => ({ schema_version: 1, instance_id: snapshot.instance.instance_id, device_id: snapshot.instance.instance_id, reset_generation: 0, seq: 1, captured_at: '2024-01-01T00:00:00Z', kind, source_id: source, payload });
  for (const [table, columns] of Object.entries(tables)) {
    if (!Array.isArray(snapshot.tables[table])) fail(400, 'invalid_backup');
    const seen = new Set();
    for (const row of snapshot.tables[table]) {
      if (!exactKeys(row, columns)) fail(400, 'invalid_backup');
      const key = JSON.stringify(primary[table].map(column => String(row[column]).toLowerCase()));
      if (seen.has(key)) fail(400, 'invalid_backup');
      seen.add(key);
      for (const column of columns) {
        const value = row[column];
        if (value === null) { if (!nullable[table]?.includes(column)) fail(400, 'invalid_backup'); continue; }
        if (['book_id', 'candidate_book_id', 'annotation_id', 'device_id', 'event_id', 'upload_id', 'baseline_id', 'native_epoch'].includes(column) && !uuid(value)) fail(400, 'invalid_backup');
        if (column === 'source_id' && !sourceId(value)) fail(400, 'invalid_backup');
        if (['digest', 'word_key'].includes(column) && !sourceId(value)) fail(400, 'invalid_backup');
        if (['seq', 'version', 'content_version', 'reset_generation', 'barrier_generation', 'native_pages', 'native_seconds', 'chunk_index', 'year', 'target'].includes(column) && (!safeInteger(value) || (['seq', 'version', 'content_version', 'year'].includes(column) && Number(value) === 0) || (column === 'year' && Number(value) > 9999))) fail(400, 'invalid_backup');
        if (column === 'archived' && typeof value !== 'boolean') fail(400, 'invalid_backup');
        if (column === 'reporting_date' && !validate('daily_query', { from: value, to: value })) fail(400, 'invalid_backup');
      }
      if (binary[table] && row[binary[table]] !== null) {
        const value = row[binary[table]];
        if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || Buffer.from(value, 'base64').toString('base64') !== value) fail(400, 'invalid_backup');
        if (table === 'sources' && Buffer.from(value, 'base64').length > 65536) fail(400, 'invalid_backup');
      }
      if (table === 'sources' && (!['epub', 'mobi', 'pdf'].includes(row.format) || (row.cover === null) !== (row.cover_type === null) || (row.cover_type !== null && !['image/jpeg', 'image/webp'].includes(row.cover_type)))) fail(400, 'invalid_backup');
      if (table === 'sources' && row.cover !== null) {
        const image = Buffer.from(row.cover, 'base64');
        const jpeg = row.cover_type === 'image/jpeg' && image.length >= 4 && image[0] === 255 && image[1] === 216 && image.at(-2) === 255 && image.at(-1) === 217;
        const webp = row.cover_type === 'image/webp' && image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP' && image.readUInt32LE(4) + 8 === image.length;
        if (!jpeg && !webp) fail(400, 'invalid_backup');
      }
      if (table === 'sources' && (!validateEnvelope(envelope('source_snapshot', row.source_id, { metadata: { version: 1, value: row.metadata }, ...(row.progress === null ? {} : { progress: { version: 1, value: row.progress } }) })) || row.metadata.format !== row.format)) fail(400, 'invalid_backup');
      if (table === 'books' && (typeof row.title !== 'string' || !row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata))) fail(400, 'invalid_backup');
      if (table === 'match_decisions' && !['confirm', 'reject'].includes(row.decision)) fail(400, 'invalid_backup');
      if (table === 'events' && (!validateEnvelope(envelope('reading_events', row.source_id, { events: [row.content] })) || row.content.event_id.toLowerCase() !== row.event_id.toLowerCase() || canonicalDigest(row.content) !== row.digest || Number(row.reset_generation) !== Number(snapshot.instance.reset_generation) || !validReportingInstant(row.content.occurred_at, config.reportingTimezone) || (row.content.type === 'reading_segment' && !validAllocation(row.content, config.reportingTimezone)))) fail(400, 'invalid_backup');
      if (table === 'uploads' && (!validate('manifest', row.manifest) || (row.committed_ack !== null && !validate('ack', row.committed_ack)))) fail(400, 'invalid_backup');
      if (table === 'packets' && !validate('ack', row.acknowledgement)) fail(400, 'invalid_backup');
      if (['annotations', 'annotation_versions'].includes(table) && (!validateEnvelope(envelope('source_snapshot', row.source_id, { annotations: { version: 1, value: [row.content] } })) || row.content.annotation_id.toLowerCase() !== row.annotation_id.toLowerCase())) fail(400, 'invalid_backup');
      if (table === 'upload_chunks' && createHash('sha256').update(Buffer.from(row.content, 'base64')).digest('hex') !== row.digest) fail(400, 'invalid_backup');
      if (table === 'vocabulary' && (!exactKeys(row.content, ['word', 'language', 'source']) || typeof row.content.word !== 'string' || ![null, 'string'].includes(row.content.language === null ? null : typeof row.content.language) || ![null, 'string'].includes(row.content.source === null ? null : typeof row.content.source) || canonicalDigest(row.content) !== row.word_key)) fail(400, 'invalid_backup');
      if (table === 'packets' && (row.acknowledgement.device_id.toLowerCase() !== row.device_id.toLowerCase() || row.acknowledgement.seq !== Number(row.seq) || row.acknowledgement.reset_generation !== Number(row.reset_generation))) fail(400, 'invalid_backup');
    }
  }
  const values = table => new Set(snapshot.tables[table].map(row => String(row[primary[table][0]]).toLowerCase()));
  const unicodeMarkers = snapshot.tables.reset_tombstones.filter(row => row.entity_type === 'unicode_version');
  if (unicodeMarkers.length > 1 || unicodeMarkers.some(row => Number(row.reset_generation) !== 0 || row.digest !== null || typeof row.entity_id !== 'string' || !/^[0-9]+[.][0-9]+$/.test(row.entity_id))) fail(400, 'invalid_backup');
  const lineages = new Map(snapshot.tables.legacy_lineages.map(row => [row.source_id, row.native_epoch.toLowerCase()]));
  for (const row of snapshot.tables.legacy_handshakes) if (lineages.get(row.source_id) !== row.native_epoch.toLowerCase() || Number(row.reset_generation) > Number(snapshot.instance.reset_generation)) fail(400, 'invalid_backup');
  const books = values('books'), sources = values('sources'), uploads = values('uploads');
  const annotations = new Set(snapshot.tables.annotations.map(row => `${row.source_id}:${row.annotation_id.toLowerCase()}`));
  if (new Set(snapshot.tables.annotations.map(row => row.annotation_id.toLowerCase())).size !== snapshot.tables.annotations.length) fail(400, 'invalid_backup');
  for (const row of snapshot.tables.book_sources) if (!sources.has(row.source_id) || !books.has(row.book_id.toLowerCase())) fail(400, 'invalid_backup');
  if (snapshot.tables.book_sources.length !== sources.size) fail(400, 'invalid_backup');
  for (const table of ['annotations', 'events', 'legacy_statistics', 'snapshot_versions']) for (const row of snapshot.tables[table]) if (!sources.has(row.source_id)) fail(400, 'invalid_backup');
  for (const row of snapshot.tables.annotation_versions) if (!annotations.has(`${row.source_id}:${row.annotation_id.toLowerCase()}`)) fail(400, 'invalid_backup');
  for (const row of snapshot.tables.upload_chunks) if (!uploads.has(row.upload_id.toLowerCase())) fail(400, 'invalid_backup');
  for (const row of snapshot.tables.match_decisions) if (!sources.has(row.source_id) || !books.has(row.candidate_book_id.toLowerCase())) fail(400, 'invalid_backup');
  const eventIdentities = new Map(snapshot.tables.event_identities.map(row => [row.event_id.toLowerCase(), row.digest]));
  for (const row of snapshot.tables.events) if (eventIdentities.get(row.event_id.toLowerCase()) !== row.digest) fail(400, 'invalid_backup');
  const annotationIdentities = new Map(snapshot.tables.annotation_identities.map(row => [row.annotation_id.toLowerCase(), row]));
  for (const row of snapshot.tables.annotations) {
    const identity = annotationIdentities.get(row.annotation_id.toLowerCase()), { context, ...body } = row.content;
    if (!identity || identity.source_id !== row.source_id || Number(identity.content_version) < Number(row.version) || identity.digest !== canonicalDigest({ ...body, annotation_id: body.annotation_id.toLowerCase() })) fail(400, 'invalid_backup');
  }
}
const INSERT_ROWS = 2000, INSERT_BYTES = 8 * 1048576;
// One row as JSON for jsonb_populate_recordset; bytea columns travel as hex text.
const rowText = (table, row) => JSON.stringify(binary[table] && row[binary[table]] !== null ? { ...row, [binary[table]]: '\\x' + Buffer.from(row[binary[table]], 'base64').toString('hex') } : row);
export async function restoreBackup(db, config, snapshot) {
  if (snapshot?.tables && ['legacy_handshakes', 'legacy_lineages'].every(key => !Object.hasOwn(snapshot.tables, key))) {
    snapshot = { ...snapshot, tables: { ...snapshot.tables, legacy_handshakes: [], legacy_lineages: [] } };
  }
  // Earlier format-v1 backups carry a legacy_carry table that nothing ever wrote to; only an empty one is accepted.
  if (snapshot?.tables && Object.hasOwn(snapshot.tables, 'legacy_carry')) {
    const { legacy_carry: carry, ...rest } = snapshot.tables;
    if (!Array.isArray(carry) || carry.length !== 0) fail(400, 'invalid_backup');
    snapshot = { ...snapshot, tables: rest };
  }
  validateBackup(snapshot, config);
  return db.withTransaction(async client => {
    await client.query('LOCK TABLE instance IN EXCLUSIVE MODE');
    const { rows: [instance] } = await client.query('SELECT instance_id, reporting_timezone, page_characters, reset_generation FROM instance WHERE singleton = TRUE FOR UPDATE');
    if (instance && (instance.reporting_timezone !== config.reportingTimezone || Number(instance.page_characters) !== config.pageCharacters)) fail(409, 'policy_mismatch');
    const counts = ['owners', 'owner_sessions', 'login_failures', 'device', ...Object.keys(tables)].map(table => `(SELECT count(*) FROM ${table})`).join(' + ');
    const { rows: [occupied] } = await client.query(`SELECT (${counts}) AS count`);
    if (Number(occupied.count) !== 0) fail(409, 'target_not_empty');
    for (const [table, columns] of Object.entries(tables)) {
      const rows = '[' + snapshot.tables[table].map(row => rowText(table, row)).join(',') + ']';
      await client.query(`SELECT sum(pg_column_size(checked)) FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb) checked`, [rows]);
    }
    const policy = snapshot.instance;
    if (instance) await client.query('UPDATE instance SET instance_id = $1, reporting_timezone = $2, page_characters = $3, reset_generation = $4 WHERE singleton = TRUE', [policy.instance_id, policy.reporting_timezone, policy.page_characters, policy.reset_generation]);
    else await client.query('INSERT INTO instance (singleton, instance_id, reporting_timezone, page_characters, reset_generation) VALUES (TRUE,$1,$2,$3,$4)', [policy.instance_id, policy.reporting_timezone, policy.page_characters, policy.reset_generation]);
    if (snapshot.device) await client.query('INSERT INTO device (singleton, token_hash, device_id, last_sync_at) VALUES (TRUE,NULL,$1,$2)', [snapshot.device.device_id, snapshot.device.last_sync_at]);
    // Set-based inserts in bounded batches: one statement per batch instead of one round trip per row.
    for (const [table, columns] of Object.entries(tables)) {
      const names = columns.join(', ');
      let batch = [], bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await client.query(`INSERT INTO ${table} (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, ['[' + batch.join(',') + ']']);
        batch = []; bytes = 0;
      };
      for (const row of snapshot.tables[table]) {
        const text = rowText(table, row);
        if (batch.length >= INSERT_ROWS || (batch.length && bytes + text.length > INSERT_BYTES)) await flush();
        batch.push(text); bytes += text.length;
      }
      await flush();
    }
  });
}
