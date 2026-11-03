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
  const restoredSource = calls.find(call => call.sql.startsWith('INSERT INTO sources')); assert.deepEqual(restoredSource.args[3], cover);
  assert.ok(calls.find(call => call.sql.startsWith('INSERT INTO event_identities')));
  const barriers = calls.filter(call => call.sql.startsWith('INSERT INTO reset_tombstones'));
  assert.deepEqual(barriers.map(call => call.args.slice(1)), [['vocabulary_identity', 'a'.repeat(64), null], ['vocabulary', 'b'.repeat(64), 'b'.repeat(64)]]);
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO vocabulary (')).args, [rows.vocabulary[0].word_key, rows.vocabulary[0].content]);
  assert.ok(calls.findIndex(call => call.sql.startsWith('SELECT sum(')) < calls.findIndex(call => /^(INSERT|UPDATE)/.test(call.sql)));
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
