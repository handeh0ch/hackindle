const dateFormatter = zone => new Intl.DateTimeFormat('en-CA', { timeZone: zone, era: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
const localDate = (formatter, seconds) => {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(p => [p.type, p.value]));
  if (parts.era !== 'AD' || Number(parts.year) > 9999) return null;
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
};
export const validReportingInstant = (instant, zone) => localDate(dateFormatter(zone), Math.floor(Date.parse(instant) / 1000)) !== null;
const offsetFormatter = zone => new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
function offsetAt(formatter, second) {
  const name = formatter.formatToParts(new Date(second * 1000)).find(part => part.type === 'timeZoneName').value;
  if (name === 'GMT') return 0;
  const [, sign, hour, minute = '0', seconds = '0'] = /^GMT([+-])(\d{2}):?(\d{2})?(?::(\d{2}))?$/.exec(name);
  return (sign === '-' ? -1 : 1) * (Number(hour) * 3600 + Number(minute) * 60 + Number(seconds));
}

export function validAllocation(event, zone) {
  if (event.timing_quality === 'unavailable') return true;
  const formatter = dateFormatter(zone);
  if (event.timing_quality === 'estimated_native_anchor') {
    const date = localDate(formatter, Math.floor(Date.parse(event.native_anchor) / 1000));
    return date !== null && event.allocation.length === 1 && event.allocation[0].date === date && event.allocation[0].seconds === event.native_seconds;
  }
  let precision = 0;
  for (const window of event.awake_windows) for (const value of [window.start, window.end]) precision = Math.max(precision, (value.split('.')[1]?.slice(0, -1) ?? '').length);
  const scale = 10n ** BigInt(precision);
  const instant = t => {
    const [whole, fraction = ''] = t.slice(0, -1).split('.');
    return BigInt(Date.parse(`${whole}Z`) / 1000) * scale + BigInt((fraction + '0'.repeat(precision)).slice(0, precision) || '0');
  };
  const offsets = offsetFormatter(zone), weights = new Map(), allocatedDates = new Set(event.allocation.map(item => item.date));
  for (const window of event.awake_windows) {
    let start = instant(window.start); const end = instant(window.end);
    while (start < end) {
      const second = Number(start / scale - (start < 0n && start % scale !== 0n ? 1n : 0n)), date = localDate(formatter, second);
      if (date === null || !allocatedDates.has(date)) return false;
      const offset = offsetAt(offsets, second), probe = second + 3600;
      let transition = probe;
      // Assumption: IANA offsets are whole seconds and transitions are at least one hour apart.
      // Temporal's transition search documents the wider spacing of known zones:
      // https://raw.githubusercontent.com/js-temporal/temporal-polyfill/main/lib/ecmascript.ts
      if (offsetAt(offsets, probe) !== offset) {
        let low = second, high = probe;
        while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (offsetAt(offsets, middle) === offset) low = middle; else high = middle; }
        transition = high;
      }
      const midnight = (Math.floor((second + offset) / 86400) + 1) * 86400 - offset;
      const next = Math.min(probe, transition, midnight);
      const boundary = BigInt(next) * scale < end ? BigInt(next) * scale : end;
      weights.set(date, (weights.get(date) ?? 0n) + boundary - start);
      start = boundary;
    }
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0n), credit = BigInt(event.native_seconds);
  const values = [...weights].map(([date, weight]) => ({ date, seconds: Number(credit * weight / total), remainder: credit * weight % total }));
  let left = event.native_seconds - values.reduce((sum, value) => sum + value.seconds, 0);
  values.sort((a, b) => a.remainder === b.remainder ? a.date.localeCompare(b.date) : a.remainder > b.remainder ? -1 : 1);
  for (const value of values) if (left-- > 0) value.seconds++;
  values.sort((a, b) => a.date.localeCompare(b.date));
  return values.length === event.allocation.length && values.every((value, i) => value.date === event.allocation[i].date && value.seconds === event.allocation[i].seconds);
}
