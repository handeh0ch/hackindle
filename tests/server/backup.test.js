import test from 'node:test';
import assert from 'node:assert/strict';
const id = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
test('backup export keeps device identity and excludes every credential', async () => {
  const backup = await import('../../server/backup.js').catch(() => null), queries = [];
  const db = { withTransaction: async work => work({ query: async sql => {
    queries.push(sql);
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '1' }] };
    if (sql.startsWith('SELECT device_id, last_sync_at')) return { rows: [{ device_id: id, last_sync_at: null }] };
    return { rows: [] };
  } }) };
  const result = await backup?.exportBackup?.(db);
  assert.equal(result?.format_version, 1); assert.equal(result.device.device_id, id); assert.equal(result.instance.reset_generation, '1');
  assert.doesNotMatch(JSON.stringify(result), /password_hash|token_hash|csrf_hash/);
  assert.ok(queries.every(sql => !/password_hash|token_hash|csrf_hash/.test(sql)));
});

test('backup preserves retained legacy handshake and lineage after sources are deleted', async () => {
  const backup = await import('../../server/backup.js');
  const handshake = { device_id: id, source_id: 'a'.repeat(64), reset_generation: '1', baseline_id: id, native_epoch: id, digest: 'b'.repeat(64) };
  const lineage = { source_id: 'a'.repeat(64), native_epoch: id };
  const source = { withTransaction: async work => work({ query: async sql => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '1' }] };
    if (sql.endsWith('FROM legacy_handshakes')) return { rows: [handshake] };
    if (sql.endsWith('FROM legacy_lineages')) return { rows: [lineage] };
    return { rows: [] };
  } }) };
  const snapshot = await backup.exportBackup(source);
  assert.deepEqual(snapshot.tables.legacy_handshakes, [handshake]);
  assert.equal(Object.hasOwn(snapshot.tables, 'legacy_carry'), false);
  assert.deepEqual(snapshot.tables.legacy_lineages, [lineage]);
  const inserts = [], target = { withTransaction: async work => work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT (')) return { rows: [{ count: '0' }] };
    if (sql.startsWith('INSERT INTO legacy_')) inserts.push([sql, args]);
    return { rows: [] };
  } }) };
  await backup.restoreBackup(target, { reportingTimezone: 'UTC', pageCharacters: 2000 }, snapshot);
  assert.equal(inserts.length, 2);
});

test('restore accepts pre-handshake format-v1 backups without inventing lineage', async () => {
  const backup = await import('../../server/backup.js');
  const source = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] } : { rows: [] } }) };
  const snapshot = await backup.exportBackup(source);
  delete snapshot.tables.legacy_handshakes; delete snapshot.tables.legacy_lineages;
  const target = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT (') ? { rows: [{ count: '0' }] } : { rows: [] } }) };
  await backup.restoreBackup(target, { reportingTimezone: 'UTC', pageCharacters: 2000 }, snapshot);
});

test('restore rejects a credentialed target before any write', async () => {
  const backup = await import('../../server/backup.js');
  const source = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] } : { rows: [] } }) };
  const snapshot = await backup.exportBackup(source); let writes = 0;
  const target = { withTransaction: async work => work({ query: async sql => {
    if (/^(INSERT|UPDATE|DELETE)/.test(sql)) writes++;
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] };
    if (sql.startsWith('SELECT (')) return { rows: [{ count: '1' }] };
    return { rows: [] };
  } }) };
  await assert.rejects(Promise.resolve().then(() => backup.restoreBackup?.(target, { reportingTimezone: 'UTC', pageCharacters: 2000 }, snapshot)), e => e.code === 'target_not_empty');
  assert.equal(writes, 0);
});

test('synthetic backup roundtrip preserves reading identities, cover and a credential-free device', async () => {
  const { readFileSync } = await import('node:fs'), { canonicalDigest } = await import('../../contracts/validate.js');
  const backup = await import('../../server/backup.js'), fixture = JSON.parse(readFileSync(new URL('../../contracts/examples/synthetic.json', import.meta.url)));
  const event = fixture.envelopes[3].payload.events[0], source = event.source_id, digest = canonicalDigest(event), cover = Buffer.from([255, 216, 255, 217]);
  const rows = {
    books: [{ book_id: id, title: 'Synthetic', metadata: {} }],
    sources: [{ source_id: source, format: 'epub', metadata: fixture.envelopes[0].payload.metadata.value, cover, cover_type: 'image/jpeg', reset_generation: '0', progress: null }],
    book_sources: [{ source_id: source, book_id: id }],
    events: [{ event_id: event.event_id, device_id: id, source_id: source, reset_generation: '0', digest, content: event }],
    event_identities: [{ event_id: event.event_id, digest }],
    vocabulary: [{ word_key: canonicalDigest({ word: 'Apple', language: 'en', source: 'synthetic' }), content: { word: 'Apple', language: 'en', source: 'synthetic' } }],
    reset_tombstones: [{ reset_generation: '0', entity_type: 'vocabulary_identity', entity_id: 'a'.repeat(64), digest: null }, { reset_generation: '0', entity_type: 'vocabulary', entity_id: 'b'.repeat(64), digest: 'b'.repeat(64) }],
  };
  const original = { withTransaction: async work => work({ query: async sql => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] };
    if (sql.startsWith('SELECT device_id, last_sync_at')) return { rows: [{ device_id: id, last_sync_at: null }] };
    const table = / FROM ([a-z_]+)$/.exec(sql)?.[1]; return { rows: rows[table] ?? [] };
  } }) };
  const data = await backup.exportBackup(original); assert.equal(data.tables.sources[0].cover, cover.toString('base64'));
  const calls = [], target = { withTransaction: async work => work({ query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] };
    if (sql.startsWith('SELECT (')) return { rows: [{ count: '0' }] };
    return { rows: [] };
  } }) };
  await backup.restoreBackup(target, { reportingTimezone: 'UTC', pageCharacters: 2000 }, data);
  const device = calls.find(call => call.sql.startsWith('INSERT INTO device')); assert.match(device.sql, /TRUE,NULL/); assert.deepEqual(device.args, [id, null]);
  const restoredSource = calls.find(call => call.sql.startsWith('INSERT INTO sources')); assert.equal(JSON.parse(restoredSource.args[0])[0].cover, '\\x' + cover.toString('hex'));
  assert.ok(calls.find(call => call.sql.startsWith('INSERT INTO event_identities')));
  const barriers = calls.filter(call => call.sql.startsWith('INSERT INTO reset_tombstones'));
  assert.equal(barriers.length, 1, 'all barriers are inserted by one set-based statement');
  assert.deepEqual(JSON.parse(barriers[0].args[0]).map(row => [row.entity_type, row.entity_id, row.digest]), [['vocabulary_identity', 'a'.repeat(64), null], ['vocabulary', 'b'.repeat(64), 'b'.repeat(64)]]);
  assert.deepEqual(JSON.parse(calls.find(call => call.sql.startsWith('INSERT INTO vocabulary (')).args[0]), [rows.vocabulary[0]]);
  assert.ok(calls.findIndex(call => call.sql.startsWith('SELECT sum(')) < calls.findIndex(call => /^(INSERT|UPDATE)/.test(call.sql)));
});


test('restore writes large tables in bounded set-based batches', async () => {
  const backup = await import('../../server/backup.js');
  const source = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] } : { rows: [] } }) };
  const snapshot = await backup.exportBackup(source);
  snapshot.tables.books = Array.from({ length: 4001 }, (_, i) => ({ book_id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), title: 'Book ' + i, metadata: {} }));
  const inserts = [], target = { withTransaction: async work => work({ query: async (sql, args) => {
    if (sql.startsWith('SELECT (')) return { rows: [{ count: '0' }] };
    if (sql.startsWith('INSERT INTO books ')) inserts.push(JSON.parse(args[0]));
    return { rows: [] };
  } }) };
  await backup.restoreBackup(target, { reportingTimezone: 'UTC', pageCharacters: 2000 }, snapshot);
  assert.deepEqual(inserts.map(batch => batch.length), [2000, 2000, 1]);
  assert.equal(new Set(inserts.flat().map(row => row.book_id)).size, 4001, 'every row is written exactly once');
});

test('restore rejects invalid structure, foreign references and corrupted data before database access', async () => {
  const backup = await import('../../server/backup.js');
  const source = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] } : { rows: [] } }) };
  const clean = await backup.exportBackup(source); let attempts = 0;
  const target = { withTransaction: async () => { attempts++; } }, config = { reportingTimezone: 'UTC', pageCharacters: 2000 };
  for (const bad of [
    { ...clean, device: { device_id: id, last_sync_at: null, token_hash: 'secret' } },
    { ...clean, instance: { ...clean.instance, reset_generation: '-1' } },
    { ...clean, tables: { ...clean.tables, book_sources: [{ source_id: 'a'.repeat(64), book_id: id }] } },
    { ...clean, tables: { ...clean.tables, reset_tombstones: [{ reset_generation: '1', entity_type: 'unicode_version', entity_id: 'bad', digest: null }] } },
  ]) await assert.rejects(backup.restoreBackup(target, config, bad), e => e.code === 'invalid_backup');
  await assert.rejects(backup.restoreBackup(target, { ...config, pageCharacters: 1 }, clean), e => e.code === 'policy_mismatch');
  assert.equal(attempts, 0);
});

test('backup CLI writes private files without overwriting and closes its database', async () => {
  const entry = await import('../../scripts/export-backup.js').catch(() => null); let closed = false, written;
  const pool = { on() {}, end: async () => { closed = true; } };
  const env = { DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' };
  await entry?.exportFile?.(env, 'synthetic-backup.json', () => pool, async (path, data, options) => { written = { path, data, options }; }, async () => ({ format_version: 1 }));
  assert.equal(written?.path, 'synthetic-backup.json'); assert.equal(written.options.flag, 'wx'); assert.equal(written.options.mode, 0o600); assert.equal(closed, true);
});

test('restore CLI passes parsed backup and private policy to restore and closes on failure', async () => {
  const entry = await import('../../scripts/import-backup.js').catch(() => null); let closed = false, observed;
  const pool = { on() {}, end: async () => { closed = true; } };
  const env = { DATABASE_URL: 'postgresql://example.invalid/test', APP_ORIGIN: 'https://example.invalid', REPORT_TIMEZONE: 'UTC' };
  await assert.rejects(Promise.resolve().then(() => entry?.importFile?.(env, 'synthetic-backup.json', () => pool, async () => '{"format_version":1}', async (db, config, data) => { observed = { config, data }; throw new Error('synthetic'); })), /synthetic/);
  assert.equal(observed?.config.reportingTimezone, 'UTC'); assert.equal(observed.data.format_version, 1); assert.equal(closed, true);
});

test('restore rejects event allocation inconsistent with policy and events from another generation', async () => {
  const { readFileSync } = await import('node:fs'), { canonicalDigest } = await import('../../contracts/validate.js');
  const { exportBackup, restoreBackup } = await import('../../server/backup.js');
  const fixture = JSON.parse(readFileSync(new URL('../../contracts/examples/synthetic.json', import.meta.url)));
  const event = fixture.envelopes[3].payload.events[0], source = event.source_id;
  const original = { withTransaction: async work => work({ query: async sql => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] };
    return { rows: [] };
  } }) };
  const data = await exportBackup(original);
  data.tables.books.push({ book_id: id, title: 'Synthetic', metadata: {} });
  data.tables.sources.push({ source_id: source, format: 'epub', metadata: fixture.envelopes[0].payload.metadata.value, cover: null, cover_type: null, reset_generation: '0', progress: null });
  data.tables.book_sources.push({ source_id: source, book_id: id });
  const digest = canonicalDigest(event);
  data.tables.events.push({ event_id: event.event_id, device_id: id, source_id: source, reset_generation: '0', digest, content: event });
  data.tables.event_identities.push({ event_id: event.event_id, digest });
  const target = { withTransaction: async () => { throw new Error('unexpected database access'); } }, config = { reportingTimezone: 'UTC', pageCharacters: 2000 };
  const badAllocation = structuredClone(data);
  badAllocation.tables.events[0].content.allocation[0].seconds++;
  badAllocation.tables.events[0].content.allocation[1].seconds--;
  badAllocation.tables.events[0].digest = canonicalDigest(badAllocation.tables.events[0].content);
  badAllocation.tables.event_identities[0].digest = badAllocation.tables.events[0].digest;
  await assert.rejects(restoreBackup(target, config, badAllocation), e => e.code === 'invalid_backup');
  const badGeneration = structuredClone(data); badGeneration.tables.events[0].reset_generation = '1';
  await assert.rejects(restoreBackup(target, config, badGeneration), e => e.code === 'invalid_backup');
  for (const [zone, occurred_at] of [['America/New_York', '0001-01-01T00:00:00Z'], ['Pacific/Kiritimati', '9999-12-31T23:59:59Z']]) {
    const badDate = structuredClone(data), row = badDate.tables.events[0];
    badDate.instance.reporting_timezone = zone;
    row.content = { event_id: event.event_id, source_id: source, session_id: event.session_id, occurred_at, type: 'session_started', cycle_id: event.session_id };
    row.digest = canonicalDigest(row.content); badDate.tables.event_identities[0].digest = row.digest;
    await assert.rejects(restoreBackup(target, { ...config, reportingTimezone: zone }, badDate), e => e.code === 'invalid_backup');
  }
});

test('restore rejects vocabulary larger than the logical snapshot limit', async () => {
  const { exportBackup, restoreBackup } = await import('../../server/backup.js');
  const source = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] } : { rows: [] } }) };
  const data = await exportBackup(source), { canonicalDigest } = await import('../../contracts/validate.js');
  const content = { word: 'a'.repeat(16777216), language: null, source: null };
  data.tables.vocabulary.push({ word_key: canonicalDigest(content), content });
  await assert.rejects(restoreBackup({ withTransaction: async () => { throw new Error('unexpected database access'); } }, { reportingTimezone: 'UTC', pageCharacters: 2000 }, data), e => e.code === 'invalid_backup');
});

test('backup covers every migrated table except credentials, sessions and migration bookkeeping', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const directory = new URL('../../db/migrations/', import.meta.url);
  const migrated = new Set();
  for (const name of readdirSync(directory).filter(file => file.endsWith('.sql'))) {
    const sql = readFileSync(new URL(name, directory), 'utf8');
    for (const match of sql.matchAll(/^\s*CREATE TABLE (?!IF NOT EXISTS)(\w+)/gim)) migrated.add(match[1]);
    for (const match of sql.matchAll(/^\s*DROP TABLE (?:IF EXISTS )?(\w+)/gim)) migrated.delete(match[1]);
  }
  const intentionallyExcluded = new Set(['owners', 'owner_sessions', 'login_failures', 'instance', 'device']);
  const exported = new Set();
  const db = { withTransaction: async work => work({ query: async sql => {
    if (sql.startsWith('SELECT instance_id')) return { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] };
    if (sql.startsWith('SELECT device_id, last_sync_at')) return { rows: [] };
    exported.add(/ FROM (\w+)/.exec(sql)[1]);
    return { rows: [] };
  } }) };
  await (await import('../../server/backup.js')).exportBackup(db);
  assert.deepEqual([...migrated].filter(table => !intentionallyExcluded.has(table) && !exported.has(table)), [], 'a migrated table is missing from backup.js');
  assert.deepEqual([...exported].filter(table => !migrated.has(table)), [], 'backup.js exports a table no migration creates');
});

test('restore accepts an older backup with an empty legacy_carry table and rejects one with rows', async () => {
  const backup = await import('../../server/backup.js');
  const source = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT instance_id') ? { rows: [{ instance_id: id, reporting_timezone: 'UTC', page_characters: '2000', reset_generation: '0' }] } : { rows: [] } }) };
  const target = { withTransaction: async work => work({ query: async sql => sql.startsWith('SELECT (') ? { rows: [{ count: '0' }] } : { rows: [] } }) };
  const config = { reportingTimezone: 'UTC', pageCharacters: 2000 };
  const snapshot = await backup.exportBackup(source);
  await backup.restoreBackup(target, config, { ...snapshot, tables: { ...snapshot.tables, legacy_carry: [] } });
  const row = { source_id: 'a'.repeat(64), reporting_date: '2024-01-01', native_pages: '2', native_seconds: '3' };
  await assert.rejects(backup.restoreBackup(target, config, { ...snapshot, tables: { ...snapshot.tables, legacy_carry: [row] } }), error => error.code === 'invalid_backup');
  await assert.rejects(backup.restoreBackup(target, config, { ...snapshot, tables: { ...snapshot.tables, legacy_carry: null } }), error => error.code === 'invalid_backup');
});
