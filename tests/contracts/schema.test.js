import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, validateEnvelope, canonicalDigest, matchesAck } from '../../contracts/validate.js';

const id = '48bc0344-efad-4c68-adb6-dc0f0ba57276';
const source = '0123456789abcdef'.repeat(4);
const envelope = () => ({ schema_version: 1, instance_id: id, device_id: id, reset_generation: 0, seq: 1, captured_at: '2024-02-29T00:00:00Z', kind: 'source_snapshot', source_id: source, payload: { annotations: { version: 1, value: [] } } });
const ack = () => ({ schema_version: 1, instance_id: id, device_id: id, reset_generation: 0, current_reset_generation: 0, source_id: source, seq: 1, kind: 'source_snapshot', status: 'applied', results: { annotations: 'applied' } });

test('accepts a successful empty annotation snapshot and rejects invalid identities, dates and section versions', () => {
  assert.equal(validateEnvelope(envelope()), true);
  for (const [key, value] of [['seq', 0], ['source_id', 'bad'], ['captured_at', '2023-02-29T00:00:00Z'], ['kind', 'unknown']]) {
    assert.equal(validateEnvelope({ ...envelope(), [key]: value }), false, key);
  }
  assert.equal(validateEnvelope({ ...envelope(), payload: { annotations: { version: 0, value: [] } } }), false);
  assert.equal(validateEnvelope({ ...envelope(), payload: {} }), false);
});

test('hashes semantic object order consistently while preserving array order', () => {
  assert.equal(canonicalDigest({ a: 1, b: 2 }), canonicalDigest({ b: 2, a: 1 }));
  assert.notEqual(canonicalDigest([1, 2]), canonicalDigest([2, 1]));
});

test('acknowledgement requires matching identities and exactly the requested result keys', () => {
  assert.equal(matchesAck(envelope(), ack()), true);
  assert.equal(matchesAck({}, {}), false);
  assert.equal(matchesAck(envelope(), { ...ack(), seq: 2 }), false);
  assert.equal(matchesAck(envelope(), { ...ack(), results: {} }), false);
  assert.equal(matchesAck(envelope(), { ...ack(), results: { annotations: 'applied', progress: 'applied' } }), false);
  assert.equal(matchesAck(envelope(), { ...ack(), reset_generation: 1 }), false);
  assert.equal(matchesAck(envelope(), { ...ack(), current_reset_generation: 1, status: 'obsolete_discarded', results: { annotations: 'discarded' } }), true);
});

test('config validates IANA timezone and transport limits', () => {
  const config = { schema_version: 1, instance_id: id, reset_generation: 0, reporting_timezone: 'Europe/Berlin', characters_per_page: 2000, limits: { direct_bytes: 1048576, envelope_bytes: 16777216, chunk_bytes: 1048576, upload_ttl_seconds: 604800, open_uploads: 2 } };
  assert.equal(validate('config', config), true);
  assert.equal(validate('config', { ...config, reporting_timezone: 'No/Such_Zone' }), false);
  assert.equal(validate('config', { ...config, characters_per_page: 0 }), false);
});
const locator = { type: 'xpointer', value: '/synthetic/1' };
const annotation = () => ({ annotation_id: id, kind: 'highlight', start: locator, end: locator, quote: 'Synthetic', note: '', chapter: null, native_timestamp: null, context: { status: 'ready', origin: 'creation', captured_at: '2024-02-29T00:00:00Z', page_basis: 'rendered', total_pages: 1, before: null, selection_pages: [{ number: 1, text: '' }], after: null } });
const segment = () => ({ event_id: id, source_id: source, session_id: id, occurred_at: '2024-02-29T00:00:00Z', type: 'reading_segment', native_seconds: 10, native_record_id: 'synthetic-native-id', measurement_version: 'provisional', provenance: 'provisional-native', timing_quality: 'observed_windows', volume_quality: 'measured', volume_date: '2024-02-29', allocation: [{ date: '2024-02-29', seconds: 10 }], credited_characters: 0, ranges: [], awake_windows: [{ start: '2024-02-28T23:59:50Z', end: '2024-02-29T00:00:00Z' }], native_anchor: null });
const eventEnvelope = () => ({ ...envelope(), kind: 'reading_events', payload: { events: [segment()] } });
test('validates context boundaries and rejects duplicate annotation identities', () => {
  const a = annotation();
  const packet = { ...envelope(), payload: { annotations: { version: 1, value: [a] } } };
  assert.equal(validateEnvelope(packet), true);
  assert.equal(validateEnvelope({ ...packet, payload: { annotations: { version: 1, value: [a, a] } } }), false);
  assert.equal(validateEnvelope({ ...packet, payload: { annotations: { version: 1, value: [{ ...a, context: { ...a.context, total_pages: 2 } }] } } }), false);
  assert.equal(validateEnvelope({ ...packet, payload: { annotations: { version: 1, value: [{ ...a, context: { status: 'pending', reason: 'synthetic failure' } }] } } }), true);
  assert.equal(validateEnvelope({ ...packet, payload: { annotations: { version: 1, value: [{ ...a, kind: 'bookmark', context: null }] } } }), true);
});
test('preserves native seconds and explicitly unavailable measurements', () => {
  const packet = eventEnvelope();
  assert.equal(validateEnvelope(packet), true);
  assert.equal(validateEnvelope({ ...packet, payload: { events: [{ ...segment(), allocation: [{ date: '2024-02-29', seconds: 9 }] }] } }), false);
  assert.equal(validateEnvelope({ ...packet, payload: { events: [{ ...segment(), timing_quality: 'estimated_native_anchor', awake_windows: [], native_anchor: '2024-02-29T00:00:00Z' }] } }), true);
  assert.equal(validateEnvelope({ ...packet, payload: { events: [{ ...segment(), timing_quality: 'unavailable', native_seconds: null, allocation: [], awake_windows: [], native_anchor: null, volume_quality: 'unavailable', volume_date: null, credited_characters: null }] } }), true);
  assert.equal(validateEnvelope({ ...packet, payload: { events: [segment(), segment()] } }), false);
  assert.equal(validateEnvelope({ ...packet, payload: { events: [{ ...segment(), source_id: 'a'.repeat(64) }] } }), false);
});
test('rejects unknown schemas and validates upload manifest bounds', () => {
  assert.equal(validate('unknown', {}), false);
  const manifest = { schema_version: 1, instance_id: id, device_id: id, reset_generation: 0, source_id: source, seq: 1, kind: 'source_snapshot', byte_length: 16777216, sha256: source, chunk_count: 16 };
  assert.equal(validate('manifest', manifest), true);
  assert.equal(validate('manifest', { ...manifest, byte_length: 16777217 }), false);
});
test('validates owner read schema and rejects malformed pagination responses', () => {
  assert.equal(validate('annotations', { items: [], next_cursor: null }), true);
  assert.equal(validate('annotations', { items: [], next_cursor: 5 }), false);
});
test('uses one frozen volume day and keeps source locators consistent', () => {
  const packet = eventEnvelope();
  const midnight = { ...segment(), volume_date: '2024-02-29', native_seconds: 10, allocation: [{ date: '2024-02-28', seconds: 4 }, { date: '2024-02-29', seconds: 6 }] };
  assert.equal(validateEnvelope({ ...packet, payload: { events: [midnight] } }), true);
  assert.equal(validateEnvelope({ ...packet, payload: { events: [{ ...midnight, credited_characters: 4 }] } }), false);
  const pdf = { type: 'pdf', page: 1, geometry_version: 'provisional', boxes: [{ x: 0, y: 0, width: 1, height: 1 }] };
  assert.equal(validateEnvelope({ ...packet, payload: { events: [{ ...midnight, credited_characters: 4, ranges: [{ start: locator, end: pdf, characters: 4 }] }] } }), false);
  const a = { ...annotation(), start: pdf, end: pdf };
  assert.equal(validateEnvelope({ ...envelope(), payload: { annotations: { version: 1, value: [a] } } }), false);
});
test('unavailable native data does not require invented provenance', () => {
  const s = { ...segment(), timing_quality: 'unavailable', native_seconds: null, native_record_id: null, provenance: null, allocation: [], awake_windows: [], native_anchor: null };
  assert.equal(validateEnvelope({ ...eventEnvelope(), payload: { events: [s] } }), true);
  assert.equal(validateEnvelope({ ...eventEnvelope(), payload: { events: [{ ...segment(), native_record_id: null }] } }), false);
});
test('synthetic example packets and owner responses satisfy their schemas', async () => {
  const { readFile } = await import('node:fs/promises');
  const examples = JSON.parse(await readFile(new URL('../../contracts/examples/synthetic.json', import.meta.url), 'utf8'));
  for (const item of examples.envelopes) assert.equal(validateEnvelope(item), true, item.kind);
  assert.equal(validate('annotations', examples.owner_annotations), true);
  assert.equal(validate('vocabulary', examples.vocabulary_unavailable), true);
  assert.equal(validate('book', examples.owner_book), true);
  assert.equal(validate('summary', examples.owner_summary), true);
});
test('owner queries enforce typed pagination and bounded inclusive dates', () => {
  assert.equal(validate('list_query', { limit: 50, byte_budget: 262144 }), true);
  assert.equal(validate('list_query', { limit: 101 }), false);
  assert.equal(validate('daily_query', { from: '2024-01-01', to: '2024-12-31' }), true);
  assert.equal(validate('daily_query', { from: '2023-01-01', to: '2024-01-02' }), false);
  assert.equal(validate('daily_query', { from: '2024-03-01', to: '2024-02-29' }), false);
});
test('summary exposes unavailable measurements rather than invented zero totals', async () => {
  const { readFile } = await import('node:fs/promises');
  const { owner_summary: summary } = JSON.parse(await readFile(new URL('../../contracts/examples/synthetic.json', import.meta.url), 'utf8'));
  assert.equal(validate('summary', { ...summary, time_status: 'unavailable', active_seconds: null, average_seconds_per_day: null }), true);
  assert.equal(validate('summary', { ...summary, time_status: 'unavailable', active_seconds: 0 }), false);
});
test('manifest chunk count and source identity match the upload bytes and kind', () => {
  const m = { schema_version: 1, instance_id: id, device_id: id, reset_generation: 0, source_id: source, seq: 1, kind: 'source_snapshot', byte_length: 1048577, sha256: source, chunk_count: 2 };
  assert.equal(validate('manifest', m), true);
  assert.equal(validate('manifest', { ...m, chunk_count: 1 }), false);
  assert.equal(validate('manifest', { ...m, byte_length: 1, chunk_count: 2 }), false);
  assert.equal(validate('manifest', { ...m, kind: 'vocabulary_snapshot' }), false);
  assert.equal(validate('manifest', { ...m, kind: 'vocabulary_snapshot', source_id: null }), true);
});
test('read contract schemas compile and enforce required response fields', () => {
  for (const name of ['books', 'book', 'sources', 'progress_history', 'daily', 'summary', 'sessions', 'cycles', 'vocabulary', 'annotations', 'annotation_detail', 'content', 'matches', 'goal', 'device', 'merge_action', 'split_action', 'match_action', 'goal_action', 'reset_action', 'reset_result', 'token_result', 'login_action', 'list_query', 'daily_query', 'summary_query', 'content_query', 'error', 'created', 'event', 'locator', 'annotation']) {
    assert.doesNotThrow(() => validate(name, {}), name);
  }
  assert.equal(validate('summary_query', { from: '2024-01-01' }), false);
  assert.equal(validate('summary_query', { from: '2024-01-01', to: '2024-12-31' }), true);
  assert.equal(validate('content_query', { field: 'context', version: 1 }), true);
});
test('PDF positions permit page-only bookmarks and progress but measured selections need geometry', () => {
  const pdf = { type: 'pdf', page: 1, geometry_version: null, boxes: [] };
  const bookmark = { ...annotation(), kind: 'bookmark', start: pdf, end: null, context: null };
  assert.equal(validateEnvelope({ ...envelope(), payload: { annotations: { version: 1, value: [bookmark] } } }), true);
  assert.equal(validate('locator', pdf), true);
  const highlight = { ...annotation(), start: pdf, end: pdf, context: { ...annotation().context, page_basis: 'original_pdf' } };
  assert.equal(validateEnvelope({ ...envelope(), payload: { annotations: { version: 1, value: [highlight] } } }), false);
});
test('owner session response requires identity, CSRF token and UTC expiry', () => {
  const session = { owner: { username: 'synthetic-owner' }, csrf_token: 'synthetic-csrf', expires_at: '2024-03-14T00:00:00Z' };
  assert.equal(validate('session', session), true);
  assert.equal(validate('session', { ...session, csrf_token: '' }), false);
  assert.equal(validate('session', { ...session, expires_at: '2024-02-30T00:00:00Z' }), false);
  assert.equal(validate('session', { owner: session.owner }), false);
});
test('reading windows are ordered, disjoint and allocation dates are unique and ordered', () => {
  const base = segment();
  const wrap = event => ({ ...eventEnvelope(), payload: { events: [event] } });
  const valid = { ...base, awake_windows: [{ start: '2024-02-28T23:59:50Z', end: '2024-02-28T23:59:55Z' }, { start: '2024-02-28T23:59:55Z', end: '2024-02-29T00:00:00Z' }], allocation: [{ date: '2024-02-28', seconds: 5 }, { date: '2024-02-29', seconds: 5 }] };
  assert.equal(validateEnvelope(wrap(valid)), true);
  assert.equal(validateEnvelope(wrap({ ...valid, awake_windows: [...valid.awake_windows].reverse() })), false);
  assert.equal(validateEnvelope(wrap({ ...valid, awake_windows: [{ ...valid.awake_windows[0], end: '2024-02-28T23:59:56Z' }, valid.awake_windows[1]] })), false);
  assert.equal(validateEnvelope(wrap({ ...valid, allocation: [...valid.allocation].reverse() })), false);
});
test('one event cannot mix rolling and PDF range engines', () => {
  const pdf = { type: 'pdf', page: 1, geometry_version: 'provisional', boxes: [{ x: 0, y: 0, width: 1, height: 1 }] };
  const e = { ...segment(), credited_characters: 2, ranges: [{ start: locator, end: locator, characters: 1 }, { start: pdf, end: pdf, characters: 1 }] };
  assert.equal(validateEnvelope({ ...eventEnvelope(), payload: { events: [e] } }), false);
});
test('a source packet cannot mix locator engines across events or snapshot sections', () => {
  const pdf = { type: 'pdf', page: 1, geometry_version: null, boxes: [] };
  const progress = { fraction: 0.5, position: pdf, observed_at: '2024-02-29T00:00:00Z', session_id: id };
  const a = annotation();
  assert.equal(validateEnvelope({ ...envelope(), payload: { annotations: { version: 1, value: [a] }, progress: { version: 1, value: progress } } }), false);
  const rolling = { ...segment(), credited_characters: 1, ranges: [{ start: locator, end: locator, characters: 1 }] };
  const sample = { event_id: 'a92e58b4-851b-467b-a5ad-1eaaccc84c61', source_id: source, session_id: id, occurred_at: '2024-02-29T00:00:00Z', type: 'progress_sample', progress };
  assert.equal(validateEnvelope({ ...eventEnvelope(), payload: { events: [rolling, sample] } }), false);
});
test('synthetic source switch, cycles, ambiguous matches and DST retain their identities and exact native totals', async () => {
  const { readFile } = await import('node:fs/promises');
  const examples = JSON.parse(await readFile(new URL('../../contracts/examples/synthetic.json', import.meta.url), 'utf8'));
  assert.equal(validate('session', examples.owner_session), true);
  assert.equal(validate('matches', examples.ambiguous_matches), true);
  assert.equal(validate('matches', { items: [{ source_id: 'bad' }], next_cursor: null }), false);
  for (const packet of examples.source_switch_and_cycle) assert.equal(validateEnvelope(packet), true);
  assert.notEqual(examples.source_switch_and_cycle[0].source_id, examples.source_switch_and_cycle[1].source_id);
  for (const { event } of examples.timing_examples) {
    assert.equal(validateEnvelope({ ...eventEnvelope(), source_id: event.source_id, payload: { events: [event] } }), true);
    assert.equal(event.allocation.reduce((sum, item) => sum + item.seconds, 0), event.native_seconds);
    assert.deepEqual(event.allocation.map(item => item.seconds), [2, 9]);
  }
});
test('owner grouping, goals and content reject malformed requests', () => {
  assert.equal(validate('merge_action', { source_ids: [source], target_book_id: id }), true);
  assert.equal(validate('merge_action', { source_ids: [source, source], target_book_id: id }), false);
  assert.equal(validate('split_action', { source_ids: [] }), false);
  assert.equal(validate('goal_action', { target: -1 }), false);
  assert.equal(validate('reset_action', { confirm: 'reset' }), true);
  assert.equal(validate('reset_action', { confirm: 'yes' }), false);
  assert.equal(validate('content_query', { field: 'context', cursor: 'synthetic', version: 1 }), true);
  assert.equal(validate('content_query', { field: 'other' }), false);
  assert.equal(validate('annotation_detail', { annotation_id: id }), false);
});

test('UUID case aliases cannot bypass annotation or event uniqueness', () => {
  const a = annotation();
  const snapshot = { ...envelope(), payload: { annotations: { version: 1, value: [a, { ...a, annotation_id: id.toUpperCase() }] } } };
  assert.equal(validateEnvelope(snapshot), false);
  const event = segment();
  assert.equal(validateEnvelope({ ...eventEnvelope(), payload: { events: [event, { ...event, event_id: id.toUpperCase() }] } }), false);
});
test('event acknowledgements reject stale while snapshots may be stale', () => {
  const packet = eventEnvelope();
  const response = { ...ack(), kind: 'reading_events', results: { [id]: 'stale' } };
  assert.equal(matchesAck(packet, response), false);
  assert.equal(matchesAck(packet, { ...response, results: { [id]: 'applied' } }), true);
  assert.equal(matchesAck(packet, { ...response, results: { [id]: 'duplicate' } }), true);
  assert.equal(matchesAck(envelope(), { ...ack(), results: { annotations: 'stale' } }), true);
});
test('owner annotation detail accepts bounded metadata and rejects full content', () => {
  const detail = { annotation_id: id, source_id: source, version: 1, kind: 'highlight', archived: false, context_status: 'pending', context_origin: null, context_captured_at: null, context_page_basis: null, context_total_pages: null, context_reason: 'synthetic failure' };
  assert.equal(validate('annotation_detail', detail), true);
  assert.equal(validate('annotation_detail', { ...detail, quote: 'Synthetic full content' }), false);
  assert.equal(validate('annotation_detail', { ...detail, context: { selection_pages: [] } }), false);
});
test('credited characters equal disjoint new range amounts and rereads carry no ranges', () => {
  const base = segment();
  const wrap = event => ({ ...eventEnvelope(), payload: { events: [event] } });
  const piece = { start: locator, end: locator, characters: 1 };
  assert.equal(validateEnvelope(wrap({ ...base, credited_characters: 999999, ranges: [piece] })), false);
  assert.equal(validateEnvelope(wrap({ ...base, credited_characters: 1, ranges: [piece] })), true);
  assert.equal(validateEnvelope(wrap({ ...base, credited_characters: 0, ranges: [{ ...piece, characters: 0 }] })), false);
});
test('PDF ready context matches highlight page endpoints and bounds', () => {
  const pdf = page => ({ type: 'pdf', page, geometry_version: 'provisional', boxes: [{ x: 0, y: 0, width: 1, height: 1 }] });
  const wrap = a => ({ ...envelope(), payload: { annotations: { version: 1, value: [a] } } });
  const good = { ...annotation(), start: pdf(1), end: pdf(1), context: { ...annotation().context, page_basis: 'original_pdf' } };
  assert.equal(validateEnvelope(wrap(good)), true);
  assert.equal(validateEnvelope(wrap({ ...good, start: pdf(10), end: pdf(10) })), false);
  assert.equal(validateEnvelope(wrap({ ...good, start: pdf(2), end: pdf(1) })), false);
});
test('legacy snapshots reject duplicate reporting dates', () => {
  const record = { date: '2024-02-29', native_pages: 1, native_seconds: 2 };
  const packet = { ...envelope(), kind: 'legacy_statistics', payload: { version: 1, records: [record] } };
  assert.equal(validateEnvelope(packet), true);
  assert.equal(validateEnvelope({ ...packet, payload: { ...packet.payload, records: [record, record] } }), false);
});
test('versioned vocabulary and legacy accept stale acknowledgements; obsolete events require discarded results', () => {
  const vocab = { ...envelope(), kind: 'vocabulary_snapshot', source_id: null, payload: { version: 1, words: [] } };
  const legacy = { ...envelope(), kind: 'legacy_statistics', payload: { version: 1, records: [] } };
  assert.equal(matchesAck(vocab, { ...ack(), source_id: null, kind: 'vocabulary_snapshot', results: { vocabulary_snapshot: 'stale' } }), true);
  assert.equal(matchesAck(legacy, { ...ack(), kind: 'legacy_statistics', results: { legacy_statistics: 'stale' } }), true);
  assert.equal(matchesAck(eventEnvelope(), { ...ack(), kind: 'reading_events', status: 'obsolete_discarded', current_reset_generation: 1, results: { [id]: 'discarded' } }), true);
});
test('PDF multipage context follows selection endpoints and includes available neighbours', () => {
  const pdf = page => ({ type: 'pdf', page, geometry_version: 'provisional', boxes: [{ x: 0, y: 0, width: 1, height: 1 }] });
  const page = number => ({ number, text: '' });
  const a = { ...annotation(), start: pdf(2), end: pdf(3), context: { ...annotation().context, page_basis: 'original_pdf', total_pages: 4, before: page(1), selection_pages: [page(2), page(3)], after: page(4) } };
  const wrap = annotation => ({ ...envelope(), payload: { annotations: { version: 1, value: [annotation] } } });
  assert.equal(validateEnvelope(wrap(a)), true);
  assert.equal(validateEnvelope(wrap({ ...a, end: pdf(4) })), false);
  assert.equal(validateEnvelope(wrap({ ...a, context: { ...a.context, total_pages: 3 } })), false);
});

test('window comparisons preserve arbitrary fractional UTC precision', () => {
  const wrap = awake_windows => ({ ...eventEnvelope(), payload: { events: [{ ...segment(), awake_windows }] } });
  assert.equal(validateEnvelope(wrap([{ start: '2024-02-29T00:00:00.0001Z', end: '2024-02-29T00:00:00.0002Z' }])), true);
  assert.equal(validateEnvelope(wrap([{ start: '2024-02-29T00:00:00.0001Z', end: '2024-02-29T00:00:00.0003Z' }, { start: '2024-02-29T00:00:00.0002Z', end: '2024-02-29T00:00:00.0004Z' }])), false);
  assert.equal(validateEnvelope(wrap([{ start: '2024-02-29 00:00:00.1Z', end: '2024-02-29T00:00:00.1000Z' }])), false);
  assert.equal(validateEnvelope(wrap([{ start: '2024-02-29T00:00:00.1Z', end: '2024-02-29 00:00:00.2Z' }])), true);
});

test('annotation detail reason preview is limited to 500 Unicode characters', () => {
  const detail = { annotation_id: id, source_id: source, version: 1, kind: 'highlight', archived: false, context_status: 'pending', context_origin: null, context_captured_at: null, context_page_basis: null, context_total_pages: null, context_reason: '😀'.repeat(500) };
  assert.equal(validate('annotation_detail', detail), true);
  assert.equal(validate('annotation_detail', { ...detail, context_reason: detail.context_reason + '😀' }), false);
});

test('annotation detail timestamp is at most 24 characters', () => {
  const detail = { annotation_id: id, source_id: source, version: 1, kind: 'highlight', archived: false, context_status: 'ready', context_origin: 'creation', context_captured_at: '2024-02-29T00:00:00.123Z', context_page_basis: 'rendered', context_total_pages: 1, context_reason: null };
  assert.equal(validate('annotation_detail', detail), true);
  assert.equal(validate('annotation_detail', { ...detail, context_captured_at: '2024-02-29T00:00:00.1234Z' }), false);
});
