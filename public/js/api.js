// Same-origin client for /api/v1. All paths are relative to the current origin, no
// server setting or credential is embedded here. The CSRF token comes from the
// session response and is sent only with mutations.
export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function createApi({ fetch: fetchFn, base = '/api/v1' }) {
  let csrf = null;

  async function request(method, path, { query, body } = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) params.set(key, String(value));
    const text = params.toString();
    const headers = {};
    const init = { method, credentials: 'same-origin', headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    if (method !== 'GET') {
      if (!csrf && !path.startsWith('/auth/login')) throw new ApiError(0, 'no_session');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    let response;
    try { response = await fetchFn(`${base}${path}${text ? `?${text}` : ''}`, init); }
    catch { throw new ApiError(0, 'network'); }
    if (response.status === 204) return null;
    let payload;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (!response.ok) throw new ApiError(response.status, payload?.error?.code ?? `http_${response.status}`);
    if (payload === undefined) throw new ApiError(response.status, 'invalid_response');
    return payload;
  }

  const api = {
    get: (path, query) => request('GET', path, { query }),
    send: (method, path, body) => request(method, path, { body }),
    async login(username, password) {
      const session = await request('POST', '/auth/login', { body: { username, password } });
      csrf = session.csrf_token;
      return session;
    },
    async session() {
      const session = await request('GET', '/auth/session');
      csrf = session.csrf_token;
      return session;
    },
    async logout() {
      await request('POST', '/auth/logout');
      csrf = null;
    },
    // Follows cursors up to maxPages; `complete` is false when more pages remain.
    async pages(path, query = {}, maxPages = 20) {
      const items = [];
      let cursor;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await api.get(path, { ...query, cursor });
        items.push(...result.items);
        cursor = result.next_cursor;
        if (!cursor) return { items, complete: true };
      }
      return { items, complete: false };
    },
  };
  return api;
}
