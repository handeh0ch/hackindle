import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../public/js/api.js';
import { buildCatalog } from '../../public/js/catalog.js';
import { loadNote, buildNoteDetail } from '../../public/js/note-detail.js';
import { noteDetailHtml } from '../../public/js/notes-view.js';
import { NOTE_1, BOOK_1, SRC_A, book, detail, fakeApi, readyContext } from './fixtures.js';

const detailPath = `GET /owner/annotations/${NOTE_1}`, contentPath = `GET /owner/annotations/${NOTE_1}/content`;
// Serves each field in the given chunks, checking that the version and cursor are carried.
function content(fields, { version = 3, log = [] } = {}) {
  return query => {
    log.push({ ...query });
    const chunks = fields[query.field];
    const index = query.cursor ? Number(query.cursor.replace('c', '')) : 0;
    return { annotation_id: NOTE_1, version, field: query.field, text: chunks[index], next_cursor: index + 1 < chunks.length ? `c${index + 1}` : null };
  };
}

test('quote, note and context are streamed by cursor with the detail version and joined', async () => {
  const log = [];
  const ctx = JSON.stringify(readyContext());
  const api = fakeApi({ [detailPath]: detail(), [contentPath]: content({ quote: ['Привет, ', 'мир'], note: ['Мысль'], context: [ctx.slice(0, 20), ctx.slice(20)] }, { log }) });
  const loaded = await loadNote(api, NOTE_1);
  assert.equal(loaded.quote, 'Привет, мир');
  assert.equal(loaded.note, 'Мысль');
  assert.equal(loaded.context.status, 'ready');
  assert.equal(loaded.context.selection_pages[0].text, 'Selected text');
  assert.ok(log.every(query => query.version === 3));
  assert.deepEqual(log.filter(query => query.field === 'quote').map(query => query.cursor), [undefined, 'c1']);
  assert.equal(api.calls.filter(call => call.path === `/owner/annotations/${NOTE_1}`).length, 1);
});

test('a version change restarts the whole load from the detail, at most three attempts', async () => {
  let version = 3, details = 0;
  const api = fakeApi({
    [detailPath]: () => { details += 1; return detail({ version }); },
    [contentPath]: query => {
      if (query.field === 'note' && version === 3) { version = 4; throw new ApiError(409, 'content_changed'); }
      return { annotation_id: NOTE_1, version: query.version, field: query.field, text: `v${query.version}-${query.field}`, next_cursor: null };
    },
  });
  const loaded = await loadNote(api, NOTE_1);
  assert.equal(details, 2);
  assert.equal(loaded.detail.version, 4);
  assert.equal(loaded.quote, 'v4-quote');
  assert.equal(loaded.note, 'v4-note');
  assert.deepEqual(loaded.context, { status: 'invalid' });   // the stub context text is not JSON
});

test('a context that is not the context shape is reported, not thrown', async () => {
  const api = fakeApi({ [detailPath]: detail(), [contentPath]: content({ quote: ['q'], note: [''], context: ['{not json'] }) });
  assert.deepEqual((await loadNote(api, NOTE_1)).context, { status: 'invalid' });
  const odd = fakeApi({ [detailPath]: detail(), [contentPath]: content({ quote: ['q'], note: [''], context: ['{"status":"ready"}'] }) });
  assert.deepEqual((await loadNote(odd, NOTE_1)).context, { status: 'invalid' });
});

test('repeated version changes end in an error state after three attempts', async () => {
  let details = 0;
  const api = fakeApi({ [detailPath]: () => { details += 1; return detail({ version: details }); }, [contentPath]: () => { throw new ApiError(409, 'content_changed'); } });
  await assert.rejects(() => loadNote(api, NOTE_1), error => error instanceof ApiError && error.code === 'content_changed');
  assert.equal(details, 3);
});

test('a chunk that reports another version also restarts, and other errors are not retried', async () => {
  let details = 0;
  const api = fakeApi({ [detailPath]: () => { details += 1; return detail(); }, [contentPath]: query => ({ annotation_id: NOTE_1, version: details === 1 ? 9 : 3, field: query.field, text: 't', next_cursor: null }) });
  assert.equal((await loadNote(api, NOTE_1)).quote, 't');
  assert.equal(details, 2);
  let failures = 0;
  const broken = fakeApi({ [detailPath]: detail(), [contentPath]: () => { failures += 1; throw new ApiError(500, 'http_500'); } });
  await assert.rejects(() => loadNote(broken, NOTE_1), error => error.code === 'http_500');
  assert.equal(failures, 1);
});

test('a bookmark without context never requests the context stream, and a runaway cursor stops', async () => {
  const log = [];
  const api = fakeApi({ [detailPath]: detail({ kind: 'bookmark', context_status: 'none', context_origin: null }), [contentPath]: content({ quote: [''], note: ['Page marker'], context: ['null'] }, { log }) });
  const loaded = await loadNote(api, NOTE_1);
  assert.equal(loaded.context, null);
  assert.ok(!log.some(query => query.field === 'context'));
  const endless = fakeApi({ [detailPath]: detail(), [contentPath]: query => ({ annotation_id: NOTE_1, version: 3, field: query.field, text: 'x', next_cursor: 'more' }) });
  await assert.rejects(() => loadNote(endless, NOTE_1), error => error instanceof ApiError && error.code === 'stream_limit');
});

const catalog = buildCatalog([book()], true);
const model = (context, patch = {}) => buildNoteDetail({ detail: detail(patch.detail), quote: patch.quote ?? 'Quote', note: patch.note ?? 'Note', context, catalog });

test('ready context lists the neighbours and selection in order with page numbers', () => {
  const view = model(readyContext());
  assert.equal(view.context.status, 'ready');
  assert.deepEqual(view.context.pages.map(page => [page.role, page.number, page.text]), [['before', 11, 'Before text'], ['selection', 12, 'Selected text'], ['after', 13, 'After text']]);
  assert.equal(view.context.boundaryBefore, null);
  assert.equal(view.context.boundaryAfter, null);
  assert.equal(view.context.origin, 'Captured when the note was made');
  assert.equal(view.context.basis, 'Pages as rendered on the device');
  assert.equal(view.source.name, 'Synthetic · EPUB');
  assert.equal(view.source.bookHref, `#/books/${BOOK_1}`);
  assert.equal(view.kind, 'Highlight');
});

test('missing neighbours are named only at the document edges and never invented', () => {
  const first = model(readyContext({ before: null, selection_pages: [{ number: 1, text: 'One' }] })).context;
  assert.equal(first.boundaryBefore, 'Start of the document');
  assert.deepEqual(first.pages.map(page => page.role), ['selection', 'after']);
  const last = model(readyContext({ after: null, selection_pages: [{ number: 99, text: 'a' }, { number: 100, text: 'b' }] })).context;
  assert.equal(last.boundaryAfter, 'End of the document');
  assert.deepEqual(last.pages.map(page => page.number), [11, 99, 100]);
  const odd = model(readyContext({ before: null, after: null })).context;      // selection is page 12 of 100: neither edge
  assert.equal(odd.boundaryBefore, 'No preceding page was captured');
  assert.equal(odd.boundaryAfter, 'No following page was captured');
});

test('a blank page is shown as blank and a backfilled context says its boundaries may differ', () => {
  const blank = model(readyContext({ before: { number: 11, text: '' }, origin: 'backfill', page_basis: 'original_pdf' })).context;
  assert.equal(blank.pages[0].blank, true);
  assert.equal(blank.pages[1].blank, false);
  assert.equal(blank.origin, 'Backfilled — page boundaries may differ');
  assert.equal(blank.basis, 'Original PDF pages');
});

test('pending, unavailable, invalid and absent context keep the note visible with a reason', () => {
  const pending = model({ status: 'pending', reason: 'Extraction is queued' }, { detail: { context_status: 'pending' } }).context;
  assert.deepEqual([pending.status, pending.reason], ['pending', 'Extraction is queued']);
  const unavailable = model(null, { detail: { context_status: 'unavailable', context_reason: 'Short reason' } }).context;
  assert.deepEqual([unavailable.status, unavailable.reason], ['unavailable', 'Short reason']);
  assert.equal(model({ status: 'invalid' }, { detail: { context_status: 'ready' } }).context.status, 'invalid');
  const none = model(null, { detail: { kind: 'bookmark', context_status: 'none' } });
  assert.equal(none.context.status, 'none');
  assert.match(none.context.text, /Bookmarks have no page context/);
  assert.match(model(null, { detail: { context_status: 'none' } }).context.text, /No context was captured/);
  assert.equal(model(null, { detail: { source_id: 'f'.repeat(64) } }).source.bookHref, null);
});

test('the note page renders long Russian text and HTML-like quotes as plain text', () => {
  const long = 'Очень длинная цитата '.repeat(400);
  const html = noteDetailHtml(model(readyContext({ selection_pages: [{ number: 12, text: '<script>alert(1)</script> & "quote"' }] }), { quote: `<img src=x onerror=1> ${long}`, note: 'Строка 1\nСтрока <2>' }));
  assert.ok(!html.includes('<script>') && !html.includes('<img'));
  assert.match(html, /<blockquote class="quote">&lt;img src=x onerror=1&gt; Очень длинная/);
  assert.match(html, /<p class="note-body">Строка 1\nСтрока &lt;2&gt;<\/p>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quote&quot;/);
  assert.ok(!/ style=/.test(html));
});

test('the page labels archived notes, context pages and document edges', () => {
  const html = noteDetailHtml(model(readyContext({ before: null, selection_pages: [{ number: 1, text: '' }, { number: 2, text: 'Two' }] }), { detail: { archived: true } }));
  assert.match(html, /<h2>Note<\/h2>/);
  assert.match(html, /<span class="chip">Highlight<\/span>/);
  assert.match(html, /<span class="chip archived">Archived<\/span>/);
  assert.match(html, /<a href="#\/notes">Back to notes<\/a>/);
  assert.match(html, new RegExp(`<a href="#/books/${BOOK_1}">Synthetic · EPUB</a>`));
  assert.match(html, /Start of the document/);
  assert.match(html, /Blank page/);
  assert.match(html, /<article class="ctx-page selection"><h4>Page 1 of 100 · highlighted<\/h4>/);
  assert.match(html, /<article class="ctx-page after"><h4>Page 13 of 100 · after the highlight<\/h4>/);
  assert.ok(html.indexOf('Start of the document') < html.indexOf('Page 1 of 100'));
  assert.match(html, /Captured when the note was made/);
});

test('statuses are written out and the other states keep the quote', () => {
  const pending = noteDetailHtml(model({ status: 'pending', reason: 'Queued <soon>' }, { detail: { context_status: 'pending' } }));
  assert.match(pending, /Context pending/);
  assert.match(pending, /Queued &lt;soon&gt;/);
  assert.match(pending, /<blockquote class="quote">Quote<\/blockquote>/);
  assert.match(noteDetailHtml(model(null, { detail: { context_status: 'unavailable', context_reason: 'No text layer' } })), /Context unavailable[\s\S]*No text layer/);
  assert.match(noteDetailHtml(model({ status: 'invalid' })), /could not be read/i);
  assert.match(noteDetailHtml(model(null, { detail: { kind: 'bookmark', context_status: 'none' }, quote: '', note: '' })), /No quoted text[\s\S]*No note/);
  assert.match(noteDetailHtml(model(null, { detail: { source_id: 'f'.repeat(64), context_status: 'none' } })), /Unknown file/);
});

test('detail source falls back when the catalog is missing', () => {
  const view = buildNoteDetail({ detail: detail({ context_status: 'none' }), quote: 'q', note: '', context: null, catalog: null });
  assert.equal(view.source.name, 'Unknown file');
  assert.equal(view.source.bookHref, null);
  assert.equal(SRC_A.length, 64);
});
