// One note: detail plus the quote, note and context text, streamed in chunks bound to the detail's
// version. A version change (409 content_changed) restarts the load from the detail.
import { ApiError } from './api.js';
import { formatInstant } from './format.js';
import { sourceName } from './catalog.js';

const ATTEMPTS = 3, MAX_CHUNKS = 64;   // 64 chunks of up to 256 KiB: far more than any note

async function stream(api, id, field, version) {
  let text = '', cursor;
  for (let chunk = 0; chunk < MAX_CHUNKS; chunk += 1) {
    const result = await api.get(`/owner/annotations/${encodeURIComponent(id)}/content`, { field, version, cursor });
    if (result.version !== version) throw new ApiError(409, 'content_changed');
    text += result.text;
    if (!result.next_cursor) return text;
    cursor = result.next_cursor;
  }
  throw new ApiError(0, 'stream_limit');
}

// The context text is the `context` definition as JSON; anything else is reported, not thrown.
function parseContext(text) {
  let value;
  try { value = JSON.parse(text); } catch { return { status: 'invalid' }; }
  if (value === null) return null;
  const ready = value.status === 'ready' && Array.isArray(value.selection_pages) && value.selection_pages.length > 0;
  const waiting = (value.status === 'pending' || value.status === 'unavailable') && typeof value.reason === 'string';
  return ready || waiting ? value : { status: 'invalid' };
}

export async function loadNote(api, id) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const detail = await api.get(`/owner/annotations/${encodeURIComponent(id)}`);
    try {
      const quote = await stream(api, id, 'quote', detail.version), note = await stream(api, id, 'note', detail.version);
      const context = detail.context_status === 'none' ? null : parseContext(await stream(api, id, 'context', detail.version));
      return { detail, quote, note, context };
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409 && error.code === 'content_changed')) throw error;
    }
  }
  throw new ApiError(409, 'content_changed');
}

const ROLES = { before: 'before the highlight', selection: 'highlighted', after: 'after the highlight' };

function readyContext(context, detail) {
  const total = context.total_pages ?? detail.context_total_pages;
  const first = context.selection_pages[0].number, last = context.selection_pages.at(-1).number;
  const pages = [...(context.before ? [['before', context.before]] : []), ...context.selection_pages.map(item => ['selection', item]), ...(context.after ? [['after', context.after]] : [])]
    .map(([role, item]) => ({ role, number: item.number, text: item.text, blank: item.text === '', heading: `Page ${item.number} of ${total} · ${ROLES[role]}` }));
  return {
    status: 'ready', pages,
    // A missing neighbour is named only at the real edge of the document; elsewhere it is simply not captured.
    boundaryBefore: context.before ? null : first === 1 ? 'Start of the document' : 'No preceding page was captured',
    boundaryAfter: context.after ? null : last === total ? 'End of the document' : 'No following page was captured',
    origin: context.origin === 'backfill' ? 'Backfilled — page boundaries may differ' : 'Captured when the note was made',
    basis: context.page_basis === 'original_pdf' ? 'Original PDF pages' : 'Pages as rendered on the device', captured: formatInstant(context.captured_at),
  };
}

function buildContext(detail, context) {
  if (detail.context_status === 'none') return { status: 'none', text: detail.kind === 'bookmark' ? 'Bookmarks have no page context.' : 'No context was captured for this note.' };
  if (context?.status === 'ready') return readyContext(context, detail);
  if (context?.status === 'pending' || context?.status === 'unavailable' || (context === null && (detail.context_status === 'pending' || detail.context_status === 'unavailable'))) {
    return { status: context?.status ?? detail.context_status, reason: context?.reason ?? detail.context_reason ?? 'No reason was recorded.' };
  }
  return { status: 'invalid' };
}

export function buildNoteDetail({ detail, quote, note, context, catalog }) {
  const found = catalog?.sources.get(detail.source_id);
  return { id: detail.annotation_id, kind: detail.kind === 'bookmark' ? 'Bookmark' : 'Highlight', archived: detail.archived, quote, note,
    source: { name: sourceName(catalog, detail.source_id), bookHref: found ? `#/books/${found.bookId}` : null }, context: buildContext(detail, context) };
}
