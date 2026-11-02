import { csrfFor } from './auth.js';
const error = (res, status, code) => res.status(status).json({ schema_version: 1, error: { code, message: code } });
function cookie(req) {
  const parts = (req.get('cookie') ?? '').split(';').map(part => part.trim().split('='));
  const matches = parts.filter(part => part[0] === 'kindle_sync_session' && part.length === 2);
  return matches.length === 1 ? matches[0][1] : '';
}
export function bearer(req) { return /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.get('authorization') ?? '')?.[1] ?? ''; }
export function createHandlers({ auth, config, profile }) {
  const options = { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/' };
  const allowed = req => req.get('origin') === config.origin;
  const sessionBody = (record, token) => ({ owner: { username: record.username }, csrf_token: csrfFor(token), expires_at: new Date(record.expiresAt).toISOString() });
  return {
    async login(req, res) {
      res.set('Cache-Control', 'no-store');
      if (!allowed(req)) return error(res, 403, 'origin_forbidden');
      if (!req.is('application/json')) return error(res, 415, 'json_required');
      if (!req.body || typeof req.body.username !== 'string' || !req.body.username || typeof req.body.password !== 'string' || !req.body.password || Object.keys(req.body).some(k => !['username', 'password'].includes(k))) return error(res, 400, 'invalid_request');
      const result = await auth.login(req.body.username, req.body.password, req.ip);
      if (result.status === 429) res.set('Retry-After', String(result.retryAfter));
      if (result.status !== 200) return error(res, result.status, result.status === 429 ? 'rate_limited' : 'invalid_credentials');
      res.cookie('kindle_sync_session', result.token, { ...options, maxAge: 14 * 86400000 });
      return res.set('Cache-Control', 'no-store').json(sessionBody(result, result.token));
    },
    async session(req, res) {
      res.set('Cache-Control', 'no-store');
      const token = cookie(req), record = await auth.session(token);
      if (!record) return error(res, 401, 'unauthorized');
      return res.set('Cache-Control', 'no-store').json(sessionBody(record, token));
    },
    async owner(req, res, next) {
      const token = cookie(req), record = await auth.session(token);
      if (!record) return error(res, await auth.device(bearer(req)) ? 403 : 401, 'unauthorized');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (!allowed(req) || !await auth.checkCsrf(token, req.get('x-csrf-token'))) return error(res, 403, 'forbidden');
        if (!req.is('application/json')) return error(res, 415, 'json_required');
      }
      return next();
    },
    async logout(req, res) {
      res.set('Cache-Control', 'no-store');
      const token = cookie(req);
      if (!await auth.session(token)) return error(res, 401, 'unauthorized');
      if (!allowed(req) || !await auth.checkCsrf(token, req.get('x-csrf-token'))) return error(res, 403, 'forbidden');
      await auth.logout(token); res.clearCookie('kindle_sync_session', options);
      return res.status(204).end();
    },
    async profile(req, res) {
      if (!await auth.device(bearer(req))) return error(res, 401, 'unauthorized');
      return res.set('Cache-Control', 'no-store').json(await profile());
    },
    async rotate(req, res) {
      if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).length !== 0) return error(res, 400, 'invalid_request');
      return res.set('Cache-Control', 'no-store').json({ device_token: await auth.rotateDevice() });
    },
  };
}
