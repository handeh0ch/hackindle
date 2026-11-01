export class ConfigurationError extends Error {}
export function startupMessage(error) { return error instanceof ConfigurationError ? error.message : 'Startup failed; check configuration and database.'; }
function fail(name) { throw new ConfigurationError(`Invalid or missing ${name}`); }
function integer(value, name, min, max) {
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) fail(name);
  return Number(value);
}
function databaseUrl(value, name) {
  try {
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) fail(name);
  } catch { fail(name); }
  return value;
}
export function loadConfig(env) {
  const database = databaseUrl(env.DATABASE_URL, 'DATABASE_URL');
  const directDatabase = env.DIRECT_DATABASE_URL ? databaseUrl(env.DIRECT_DATABASE_URL, 'DIRECT_DATABASE_URL') : database;
  let origin;
  try {
    const parsed = new URL(env.APP_ORIGIN);
    if (parsed.origin !== env.APP_ORIGIN || !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) fail('APP_ORIGIN');
    origin = parsed.origin;
  } catch { fail('APP_ORIGIN'); }
  const reportingTimezone = env.REPORT_TIMEZONE;
  try {
    if (!reportingTimezone || /^[+-]/.test(reportingTimezone)) fail('REPORT_TIMEZONE');
    new Intl.DateTimeFormat('en', { timeZone: reportingTimezone });
  } catch { fail('REPORT_TIMEZONE'); }
  const host = env.HOST || '127.0.0.1';
  if (/\s/.test(host)) fail('HOST');
  return Object.freeze({ databaseUrl: database, directDatabaseUrl: directDatabase, origin, reportingTimezone,
    pageCharacters: integer(env.PAGE_CHARACTERS ?? '2000', 'PAGE_CHARACTERS', 1, Number.MAX_SAFE_INTEGER),
    host, port: integer(env.PORT ?? '3000', 'PORT', 1, 65535),
    trustProxy: integer(env.TRUST_PROXY ?? '0', 'TRUST_PROXY', 0, 255), secureCookies: origin.startsWith('https:') });
}
