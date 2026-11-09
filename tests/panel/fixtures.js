// Synthetic fixtures and a fake API for the F2 panel tests. No server, database or HTTP.
import { ApiError } from '../../projects/frontend/js/core/api.js';
import { createController } from '../../projects/frontend/js/core/app.js';

export const SRC_A = 'a'.repeat(64), SRC_B = 'b'.repeat(64), SRC_C = 'c'.repeat(64);
export const BOOK_1 = '11111111-1111-4111-8111-111111111111', BOOK_2 = '22222222-2222-4222-8222-222222222222';
export const NOTE_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NOTE_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export const source = (id, format, patch = {}) => ({ source_id: id, format, title: 'Synthetic', authors: [], progress: null, last_opened_at: null, cover_available: false, ...patch });
export const sample = (fraction, observed_at = '2026-11-07T10:00:00Z') => ({ fraction, position: { engine: 'x', type: 'page', value: '1', boxes: [], geometry_version: null }, observed_at, session_id: SESSION });
export const book = (patch = {}) => ({ book_id: BOOK_1, title: 'Synthetic Book', authors: ['A. Writer'],
  sources: [source(SRC_A, 'epub', { progress: sample(0.4) }), source(SRC_B, 'pdf', { progress: sample(0.7) })],
  active_annotations: 3, archived_annotations: 1, most_recent_source_id: SRC_B, first_tracked_at: '2026-10-01T08:00:00Z', last_tracked_at: '2026-11-07T10:00:00Z', active_days: 5, ...patch });
export const book2 = () => book({ book_id: BOOK_2, title: 'Other Book', sources: [source(SRC_C, 'mobi')], active_annotations: 2, archived_annotations: 0, most_recent_source_id: SRC_C });
export const day = (date, characters, seconds = 60, patch = {}) => ({ date, characters, active_seconds: characters === null ? null : seconds,
  volume_status: characters === null ? 'unavailable' : 'available', time_status: characters === null ? 'unavailable' : 'available', ...patch });
export const session = (n, patch = {}) => ({ session_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, source_id: SRC_B, started_at: `2026-11-0${n}T10:00:00Z`,
  ended_at: `2026-11-0${n}T10:30:00Z`, characters: 4000, active_seconds: 1500, cycle_id: null, volume_status: 'available', time_status: 'available', ...patch });
export const note = (n, patch = {}) => ({ annotation_id: n === 1 ? NOTE_1 : NOTE_2, source_id: SRC_A, version: 3, kind: 'highlight', archived: false, quote_preview: `Quote ${n}`, note_preview: `Note ${n}`, context_status: 'ready', ...patch });
export const detail = (patch = {}) => ({ annotation_id: NOTE_1, source_id: SRC_A, version: 3, kind: 'highlight', archived: false, context_status: 'ready', context_origin: 'creation',
  context_captured_at: '2026-11-07T10:00:00Z', context_page_basis: 'rendered', context_total_pages: 100, context_reason: null, ...patch });
export const readyContext = (patch = {}) => ({ status: 'ready', origin: 'creation', captured_at: '2026-11-07T10:00:00Z', page_basis: 'rendered', total_pages: 100,
  before: { number: 11, text: 'Before text' }, selection_pages: [{ number: 12, text: 'Selected text' }], after: { number: 13, text: 'After text' }, ...patch });

// answers: { "GET /owner/path": value | Error | (query, body) => value }. Unknown routes answer 404.
export function fakeApi(answers = {}) {
  const calls = [];
  const respond = (method, path, query, body) => {
    calls.push({ method, path, query, body });
    const answer = answers[`${method} ${path}`];
    if (answer === undefined) throw new ApiError(404, 'not_found');
    const value = typeof answer === 'function' ? answer(query, body) : answer;
    if (value instanceof Error) throw value;
    return value;
  };
  const api = {
    calls,
    async get(path, query) { return respond('GET', path, query); },
    async send(method, path, body) { return respond(method, path, undefined, body); },
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
    session: async () => ({ owner: { username: 'o' }, csrf_token: 't' }),
    login: async () => {}, logout: async () => {},
  };
  return api;
}

export function appHarness(answers, today = '2026-11-08') {
  const api = fakeApi({ 'GET /owner/config': { characters_per_page: 2000, reporting_timezone: 'UTC' }, ...answers });
  const rendered = [], hints = [];
  const controller = createController({ api, render: (html, focus) => { rendered.push(html); hints.push(focus); }, today: () => today });
  return { api, controller, rendered, hints, calls: api.calls, last: () => rendered.at(-1), lastHint: () => hints.at(-1) };
}

export const page = (items, next_cursor = null) => ({ items, next_cursor });
