import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addFormat('iana-timezone', value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return !/^[+-]/.test(value); }
  catch { return false; }
});
for (const name of ['events', 'sync', 'uploads', 'read-api']) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`./${name}.schema.json`, import.meta.url), 'utf8')));
}
const readNames = ['books', 'book', 'sources', 'progress_history', 'daily', 'summary', 'sessions', 'cycles', 'vocabulary', 'annotations', 'annotation_detail', 'content', 'matches', 'goal', 'device', 'merge_action', 'split_action', 'match_action', 'goal_action', 'reset_action', 'reset_result', 'token_result', 'login_action', 'session', 'list_query', 'daily_query', 'summary_query', 'content_query'];
const urls = { ...Object.fromEntries(readNames.map(name => [name, 'read-api'])), envelope: 'sync', config: 'sync', ack: 'sync', error: 'sync', manifest: 'uploads', created: 'uploads', event: 'events', locator: 'events', annotation: 'events' };
export function validate(name, value) {
  if (!Object.hasOwn(urls, name)) return false;
  if (!ajv.validate(`https://hackindle.local/contracts/${urls[name]}.schema.json#/$defs/${name}`, value)) return false;
  if (name === 'manifest') return (value.kind === 'vocabulary_snapshot') === (value.source_id === null) && value.chunk_count <= value.byte_length && value.chunk_count * 1048576 >= value.byte_length;
  if ((name === 'daily_query' || name === 'summary_query') && value.from) {
    const days = (Date.parse(value.to) - Date.parse(value.from)) / 86400000;
    return days >= 0 && (name !== 'daily_query' || days < 366);
  }
  return true;
}

function unique(values) { return new Set(values).size === values.length; }
function compareInstant(a, b) {
  const parts = value => { const [whole, fraction = ''] = value.slice(0, -1).toUpperCase().split('.'); return [whole.slice(0, 10) + 'T' + whole.slice(11), fraction.replace(/0+$/, '')]; };
  const [aw, af] = parts(a), [bw, bf] = parts(b);
  return aw < bw ? -1 : aw > bw ? 1 : af < bf ? -1 : af > bf ? 1 : 0;
}
function validContext(annotation) {
  const c = annotation.context;
  if (annotation.end !== null && annotation.start.type !== annotation.end.type) return false;
  if (annotation.kind === 'highlight' && annotation.start.type === 'pdf' && (annotation.start.boxes.length === 0 || annotation.end === null || annotation.end.boxes.length === 0)) return false;
  if (annotation.kind === 'highlight' && annotation.start.type === 'pdf' && annotation.start.page > annotation.end.page) return false;
  if (c?.status === 'ready' && ((annotation.start.type === 'pdf') !== (c.page_basis === 'original_pdf'))) return false;
  if (c?.status === 'ready' && annotation.start.type === 'pdf' && (c.selection_pages[0].number !== annotation.start.page || c.selection_pages.at(-1).number !== annotation.end?.page)) return false;
  if (annotation.kind === 'bookmark') return c === null;
  if (c === null) return false;
  if (c.status !== 'ready') return true;
  const pages = [...(c.before ? [c.before.number] : []), ...c.selection_pages.map(p => p.number), ...(c.after ? [c.after.number] : [])];
  return pages.every((p, i) => p <= c.total_pages && (i === 0 || p === pages[i - 1] + 1)) &&
    (c.before !== null || pages[0] === 1) && (c.after !== null || pages.at(-1) === c.total_pages);
}
function validSegment(event) {
  if (event.volume_quality === 'unavailable' ? event.credited_characters !== null || event.volume_date !== null || event.ranges.length !== 0 : event.credited_characters === null || event.volume_date === null || (event.credited_characters > 0 && event.ranges.length === 0)) return false;
  if (event.volume_quality === 'measured' && (event.ranges.reduce((total, range) => total + range.characters, 0) !== event.credited_characters || (event.credited_characters === 0 && event.ranges.length !== 0))) return false;
  if (new Set(event.ranges.map(r => r.start.type)).size > 1 || !event.ranges.every(r => r.start.type === r.end.type && (r.start.type !== 'pdf' || (r.start.boxes.length > 0 && r.end.boxes.length > 0)))) return false;
  if (event.timing_quality === 'unavailable') return event.native_seconds === null && event.allocation.length === 0 && event.awake_windows.length === 0 && event.native_anchor === null;
  if (event.native_record_id === null || event.provenance === null || event.native_seconds === null || event.allocation.length === 0 || !event.allocation.every((a, i) => i === 0 || event.allocation[i - 1].date < a.date) || event.allocation.reduce((n, a) => n + a.seconds, 0) !== event.native_seconds) return false;
  if (event.timing_quality === 'estimated_native_anchor') return event.native_anchor !== null && event.awake_windows.length === 0;
  return event.native_anchor === null && event.awake_windows.length > 0 && event.awake_windows.every((w, i) => compareInstant(w.start, w.end) < 0 && (i === 0 || compareInstant(event.awake_windows[i - 1].end, w.start) <= 0));
}
export function validateEnvelope(value) {
  if (!validate('envelope', value)) return false;
  if (value.kind === 'legacy_statistics' && !unique(value.payload.records.map(record => record.date))) return false;
  const types = [];
  if (value.kind === 'source_snapshot' && value.payload.progress) types.push(value.payload.progress.value.position.type);
  if (value.kind === 'source_snapshot' && value.payload.annotations) {
    const annotations = value.payload.annotations.value;
    if (!unique(annotations.map(a => a.annotation_id.toLowerCase())) || !annotations.every(validContext)) return false;
    types.push(...annotations.map(a => a.start.type));
  }
  if (value.kind === 'reading_events') {
    const events = value.payload.events;
    if (!unique(events.map(e => e.event_id.toLowerCase())) || !events.every(e => e.source_id === value.source_id && (e.type !== 'reading_segment' || validSegment(e)))) return false;
    for (const event of events) {
      if (event.type === 'progress_sample') types.push(event.progress.position.type);
      if (event.type === 'reading_segment') types.push(...event.ranges.map(r => r.start.type));
    }
  }
  return new Set(types).size <= 1;
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export function canonicalDigest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function matchesAck(envelope, ack) {
  if (!validateEnvelope(envelope) || !validate('ack', ack)) return false;
  if (!['schema_version', 'instance_id', 'device_id', 'source_id', 'seq', 'kind', 'reset_generation'].every(k => envelope[k] === ack[k])) return false;
  const expected = envelope.kind === 'source_snapshot' ? Object.keys(envelope.payload) : envelope.kind === 'reading_events' ? envelope.payload.events.map(e => e.event_id) : [envelope.kind];
  const actual = Object.keys(ack.results);
  if (expected.length !== actual.length || !expected.every(k => Object.hasOwn(ack.results, k))) return false;
  if (envelope.kind === 'reading_events' && ack.status !== 'obsolete_discarded' && actual.some(k => ack.results[k] === 'stale')) return false;
  return ack.status === 'obsolete_discarded'
    ? ack.current_reset_generation > ack.reset_generation && actual.every(k => ack.results[k] === 'discarded')
    : ack.current_reset_generation === ack.reset_generation && actual.every(k => ack.results[k] !== 'discarded');
}
