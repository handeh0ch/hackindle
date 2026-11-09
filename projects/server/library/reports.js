import { validate } from '../../../contracts/validate.js';
import { SyncError } from '../sync/sync.js';
import { vocabulary } from './vocabulary.js';
import { safeTotal } from './safe-total.js';
import { READ_SNAPSHOT } from './read-snapshot.js';
const dateNumber = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
const dateString = number => new Date(number * 86400000).toISOString().slice(0, 10);
const status = (measured, unknown) => unknown ? (measured ? 'partial' : 'unavailable') : 'available';
export function summarize({ rows, today, from, to, earliest, denominator, legacy_pages, legacy_seconds, words, annotations, daily = false }) {
  const data = new Map(rows.map(row => [row.date, row])), todayNumber = dateNumber(today);
  const day = date => {
    if (date > today) return { date, characters: null, active_seconds: null, volume_status: 'unavailable', time_status: 'unavailable' };
    const row = data.get(date);
    if (!row) return { date, characters: 0, active_seconds: 0, volume_status: 'available', time_status: 'available' };
    const volume_status = status(Number(row.volume_measured), Number(row.volume_unknown)), time_status = status(Number(row.time_measured), Number(row.time_unknown));
    return { date, characters: volume_status === 'unavailable' ? null : safeTotal(row.characters ?? 0), active_seconds: time_status === 'unavailable' ? null : safeTotal(row.active_seconds ?? 0), volume_status, time_status };
  };
  const start = from ?? earliest, end = to ?? today, startNumber = start ? dateNumber(start) : todayNumber + 1;
  const elapsed = Math.max(0, Math.min(dateNumber(end), todayNumber) - startNumber + 1);
  let characters = 0, seconds = 0, vm = 0, vu = 0, tm = 0, tu = 0, record = null;
  for (const row of rows) if ((!start || row.date >= start) && row.date <= end && row.date <= today) {
    characters = safeTotal(characters + safeTotal(row.characters ?? 0)); seconds = safeTotal(seconds + safeTotal(row.active_seconds ?? 0));
    vm += Number(row.volume_measured); vu += Number(row.volume_unknown); tm += Number(row.time_measured); tu += Number(row.time_unknown);
    if (Number(row.characters ?? 0) > 0 && (!record || Number(row.characters) > record.characters || (Number(row.characters) === record.characters && row.date < record.date))) record = day(row.date);
  }
  const active = date => { const value = day(date); return Number(value.characters ?? 0) > 0 || Number(value.active_seconds ?? 0) > 0; };
  let streak = 0, cursor = todayNumber;
  if (!active(today)) cursor--;
  while (active(dateString(cursor))) { streak++; cursor--; }
  const volume_status = status(vm, vu), time_status = status(tm, tu);
  const result = { characters: volume_status === 'unavailable' ? null : characters, active_seconds: time_status === 'unavailable' ? null : seconds,
    conditional_pages: volume_status === 'unavailable' ? null : characters / denominator,
    legacy_native_pages: safeTotal(legacy_pages), legacy_native_seconds: safeTotal(legacy_seconds), current_streak: streak, elapsed_days: elapsed,
    average_characters_per_day: elapsed && volume_status !== 'unavailable' ? characters / elapsed : null,
    average_seconds_per_day: elapsed && time_status !== 'unavailable' ? seconds / elapsed : null,
    record_day: record, saved_words: words, active_annotations: safeTotal(annotations), volume_status, time_status };
  if (!daily) return result;
  const days = []; for (let n = startNumber; n <= dateNumber(end); n++) days.push(day(dateString(n)));
  return { days, summary: result };
}

export async function statistics(db, request, daily = false) {
  const fail = () => { throw new SyncError(400, 'invalid_request'); };
  if (!validate(daily ? 'daily_query' : 'summary_query', request)) fail();
  if (request.from && (request.from > request.to || (daily && dateNumber(request.to) - dateNumber(request.from) >= 366))) fail();
  return db.withTransaction(async client => {
    await client.query(READ_SNAPSHOT);
    const { rows: [instance] } = await client.query(`SELECT instance_id, reset_generation, reporting_timezone, page_characters,
      (CURRENT_TIMESTAMP AT TIME ZONE reporting_timezone)::date::text AS today FROM instance WHERE singleton = TRUE`);
    const scope = [request.book_id ?? null], localDate = `((substring(e.content->>'occurred_at' FROM 1 FOR 19)::timestamp AT TIME ZONE 'UTC') AT TIME ZONE $2)::date::text`;
    const { rows } = await client.query(`WITH scoped AS (SELECT e.* FROM events e JOIN book_sources bs ON bs.source_id = e.source_id WHERE ($1::uuid IS NULL OR bs.book_id = $1)), contributions AS (
      SELECT e.content->>'volume_date' AS date, (e.content->>'credited_characters')::numeric AS characters, 0::numeric AS seconds, 1 AS vm, 0 AS vu, 0 AS tm, 0 AS tu FROM scoped e WHERE e.content->>'type' = 'reading_segment' AND e.content->>'volume_quality' = 'measured'
      UNION ALL SELECT ${localDate}, 0, 0, 0, 1, 0, 0 FROM scoped e WHERE e.content->>'type' = 'reading_segment' AND e.content->>'volume_quality' = 'unavailable'
      UNION ALL SELECT a->>'date', 0, (a->>'seconds')::numeric, 0, 0, 1, 0 FROM scoped e CROSS JOIN LATERAL jsonb_array_elements(e.content->'allocation') a WHERE e.content->>'type' = 'reading_segment' AND e.content->>'timing_quality' <> 'unavailable'
      UNION ALL SELECT ${localDate}, 0, 0, 0, 0, 0, 1 FROM scoped e WHERE e.content->>'type' = 'reading_segment' AND e.content->>'timing_quality' = 'unavailable')
      SELECT date, sum(characters) AS characters, sum(seconds) AS active_seconds, sum(vm) AS volume_measured, sum(vu) AS volume_unknown, sum(tm) AS time_measured, sum(tu) AS time_unknown FROM contributions GROUP BY date ORDER BY date`, [...scope, instance.reporting_timezone]);
    const { rows: [first] } = await client.query(`SELECT min(day) AS earliest FROM (
      SELECT ${localDate} AS day FROM events e JOIN book_sources bs ON bs.source_id = e.source_id WHERE ($1::uuid IS NULL OR bs.book_id = $1)
      UNION ALL SELECT e.content->>'volume_date' FROM events e JOIN book_sources bs ON bs.source_id = e.source_id WHERE ($1::uuid IS NULL OR bs.book_id = $1) AND e.content->>'type' = 'reading_segment' AND e.content->>'volume_quality' = 'measured'
      UNION ALL SELECT a->>'date' FROM events e JOIN book_sources bs ON bs.source_id = e.source_id CROSS JOIN LATERAL jsonb_array_elements(e.content->'allocation') a WHERE ($1::uuid IS NULL OR bs.book_id = $1) AND e.content->>'type' = 'reading_segment') history WHERE day <= $3`, [...scope, instance.reporting_timezone, instance.today]);
    const { rows: [totals] } = await client.query(`SELECT COALESCE((SELECT sum(l.native_pages) FROM legacy_statistics l JOIN book_sources bs ON bs.source_id = l.source_id WHERE ($1::uuid IS NULL OR bs.book_id = $1) AND ($2::date IS NULL OR l.reporting_date >= $2) AND l.reporting_date <= LEAST(COALESCE($3::date, $4::date), $4::date)),0) AS legacy_pages,
      COALESCE((SELECT sum(l.native_seconds) FROM legacy_statistics l JOIN book_sources bs ON bs.source_id = l.source_id WHERE ($1::uuid IS NULL OR bs.book_id = $1) AND ($2::date IS NULL OR l.reporting_date >= $2) AND l.reporting_date <= LEAST(COALESCE($3::date, $4::date), $4::date)),0) AS legacy_seconds,
      (SELECT count(*) FROM annotations a JOIN book_sources bs ON bs.source_id = a.source_id WHERE NOT a.archived AND ($1::uuid IS NULL OR bs.book_id = $1)) AS annotations`, [...scope, request.from ?? null, request.to ?? null, instance.today]);
    const words = await vocabulary({ withTransaction: work => work(client) }, { limit: '1' }, true);
    return summarize({ rows, today: instance.today, from: request.from, to: request.to, earliest: first.earliest, denominator: Number(instance.page_characters), ...totals, words: words.count, daily });
  });
}
