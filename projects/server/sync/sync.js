import { createHash } from 'node:crypto';
import { canonicalDigest, validateEnvelope } from '../../../contracts/validate.js';
import { validAllocation, validReportingInstant } from './allocation.js';
import { UNICODE_VERSION } from '../text/unicode-lower.js';
export class SyncError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const fail = (status, code) => { throw new SyncError(status, code); };
const tokenDigest = token => createHash('sha256').update(token).digest('hex');
function resultKeys(envelope) {
  return envelope.kind === 'source_snapshot' ? Object.keys(envelope.payload) : envelope.kind === 'reading_events' ? envelope.payload.events.map(e => e.event_id) : [envelope.kind];
}
function acknowledgement(e, current, status, results) {
  return { schema_version: 1, instance_id: e.instance_id, device_id: e.device_id, source_id: e.source_id, reset_generation: e.reset_generation, current_reset_generation: current, seq: e.seq, kind: e.kind, status, results };
}
function validatePacket(envelope) {
  if (!validateEnvelope(envelope)) fail(400, 'invalid_envelope');
}
export function createSyncService({ db, createTx }) {
  async function apply(tx, token, envelope) {
    validatePacket(envelope);
    const instance = await tx.lock();
    if (instance.instance_id.toLowerCase() !== envelope.instance_id.toLowerCase()) fail(403, 'instance_mismatch');
    const hash = tokenDigest(token), device = await tx.device(hash);
    if (!device) fail(401, 'unauthorized');
    if (device.device_id && device.device_id.toLowerCase() !== envelope.device_id.toLowerCase()) fail(403, 'device_mismatch');
    const digest = canonicalDigest(envelope), previous = await tx.packet(envelope.device_id, envelope.seq);
    if (previous && previous.digest !== digest) fail(409, 'packet_conflict');
    const generation = Number(instance.reset_generation);
    if (envelope.reset_generation > generation) fail(409, 'future_generation');
    if (envelope.reset_generation < generation) {
      const discarded = acknowledgement(envelope, generation, 'obsolete_discarded', Object.fromEntries(resultKeys(envelope).map(key => [key, 'discarded'])));
      if (!previous) await tx.savePacket(envelope, digest, discarded);
      return discarded;
    }
    if (previous) return previous.ack;
    if (envelope.kind === 'vocabulary_snapshot' && generation > 0 && envelope.payload.unicode_version !== UNICODE_VERSION) fail(409, 'unicode_version_mismatch');
    if (envelope.kind === 'vocabulary_snapshot') {
      const unicode = await tx.vocabularyUnicode();
      if (unicode.version && unicode.version !== UNICODE_VERSION) fail(409, 'unicode_version_mismatch');
      if (!unicode.version && unicode.unknown) fail(409, 'unicode_version_unknown');
      if (!unicode.version) await tx.rememberVocabularyUnicode(UNICODE_VERSION);
    }
    const source = envelope.source_id === null ? null : await tx.source(envelope.source_id);
    if (envelope.source_id !== null && !source && !(envelope.kind === 'source_snapshot' && envelope.payload.metadata)) fail(400, 'source_metadata_required');
    const supplied = envelope.kind === 'source_snapshot' ? envelope.payload.metadata?.value : null;
    if (source && supplied && source.format !== supplied.format) fail(409, 'source_format_conflict');
    const format = source?.format ?? supplied?.format;
    const locators = envelope.kind === 'source_snapshot' ? [
      ...(envelope.payload.annotations?.value.map(a => a.start) ?? []),
      ...(envelope.payload.progress ? [envelope.payload.progress.value.position] : []),
    ] : envelope.kind === 'reading_events' ? envelope.payload.events.flatMap(event => event.type === 'progress_sample' ? [event.progress.position] : event.type === 'reading_segment' ? event.ranges.map(range => range.start) : []) : [];
    if (locators.some(locator => (locator.type === 'pdf') !== (format === 'pdf'))) fail(400, 'source_format_mismatch');
    if (envelope.kind === 'reading_events' && envelope.payload.events.some(event => !validReportingInstant(event.occurred_at, instance.reporting_timezone) || (event.type === 'reading_segment' && !validAllocation(event, instance.reporting_timezone)))) fail(400, 'invalid_allocation');
    if (!await tx.bind(hash, envelope.device_id)) fail(403, 'device_mismatch');
    const results = {};
    async function section(name, section, applyValue) {
      const key = JSON.stringify([envelope.device_id.toLowerCase(), envelope.source_id, name, generation]);
      const old = await tx.section(key), digest = canonicalDigest(section.value);
      let result = 'applied';
      if (old && section.version < Number(old.version)) result = 'stale';
      else if (old && section.version === Number(old.version)) {
        if (old.digest !== digest) fail(409, 'section_conflict');
        result = 'duplicate';
      }
      if (result === 'applied') { await applyValue(section.value); await tx.saveSection(key, section.version, digest); }
      results[name] = result;
    }
    if (envelope.kind === 'source_snapshot') {
      for (const name of ['metadata', 'annotations', 'progress']) {
        if (envelope.payload[name]) await section(name, envelope.payload[name], value => tx[name](envelope.source_id, value, generation));
      }
    } else if (envelope.kind === 'reading_events') {
      for (const event of envelope.payload.events) {
        const old = await tx.event(event.event_id), eventDigest = canonicalDigest(event);
        if (old && old.digest !== eventDigest) fail(409, 'event_conflict');
        if (!old) await tx.saveEvent(event, eventDigest, envelope, generation);
        results[event.event_id] = old ? 'duplicate' : 'applied';
      }
    } else if (envelope.kind === 'legacy_statistics') {
      const payload = envelope.payload;
      if (!payload.mode) {
        if (generation !== 0) fail(409, 'legacy_upgrade_required');
        await section('legacy_statistics', { version: payload.version, value: payload.records }, v => tx.legacy(envelope.source_id, v, false));
      } else {
      const id = payload.baseline_id.toLowerCase(), device = envelope.device_id.toLowerCase();
      const baseline = await tx.legacyBaseline(device, envelope.source_id, generation);
      if (payload.mode === 'baseline') {
        const baselineDigest = canonicalDigest(payload);
        if (baseline && (baseline.baseline_id.toLowerCase() !== id || baseline.digest !== baselineDigest)) fail(409, 'legacy_baseline_conflict');
        if (!baseline) await tx.establishLegacyBaseline(device, envelope.source_id, generation, id, baselineDigest, payload.records, payload.native_epoch.toLowerCase());
        results.legacy_statistics = baseline ? 'duplicate' : 'applied';
      } else {
        if (!baseline) fail(409, 'legacy_baseline_required');
        if (baseline.baseline_id.toLowerCase() !== id) fail(409, 'legacy_baseline_conflict');
        if (baseline.native_epoch.toLowerCase() !== payload.native_epoch.toLowerCase()) fail(409, 'legacy_epoch_conflict');
        await section('legacy_statistics_v2', { version: payload.version, value: payload }, v => tx.legacy(envelope.source_id, v.records));
        results.legacy_statistics = results.legacy_statistics_v2;
        delete results.legacy_statistics_v2;
      }
      }
    } else {
      const name = envelope.kind;
      const value = name === 'vocabulary_snapshot' ? envelope.payload.words : envelope.payload.records;
      await section(name, { version: envelope.payload.version, value }, v => name === 'vocabulary_snapshot' ? tx.vocabulary(v) : tx.legacy(envelope.source_id, v));
    }
    const ack = acknowledgement(envelope, generation, 'applied', results);
    await tx.savePacket(envelope, digest, ack); await tx.touch();
    return ack;
  }
  async function ingest(token, envelope) {
    validatePacket(envelope);
    if (typeof token !== 'string' || !token) fail(401, 'unauthorized');
    return db.withTransaction(client => apply(createTx(client), token, envelope));
  }
  return { ingest, apply };
}
