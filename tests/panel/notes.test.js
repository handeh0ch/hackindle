import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../../projects/frontend/js/models/catalog.js';
import { DEFAULT_FILTERS, normalizeFilters, reconcileFilters, listQuery, noteCounts, buildNotes } from '../../projects/frontend/js/models/notes.js';
import { notesHtml } from '../../projects/frontend/js/views/notes-view.js';
import { BOOK_1, BOOK_2, SRC_A, SRC_B, SRC_C, NOTE_1, NOTE_2, book, book2, note } from './fixtures.js';

const catalog = buildCatalog([book(), book2()], true);

test('filters accept only known books and sources and keep the archive choice', () => {
  assert.deepEqual(DEFAULT_FILTERS, { search: '', book: '', source: '', archive: 'active' });
  const kept = normalizeFilters({ q: '  quote  ', book: BOOK_1, source: SRC_A }, catalog, { ...DEFAULT_FILTERS, archive: 'archived' });
  assert.deepEqual(kept, { search: 'quote', book: BOOK_1, source: SRC_A, archive: 'archived' });
  assert.equal(normalizeFilters({ book: 'nope' }, catalog, DEFAULT_FILTERS).book, '');
  assert.equal(normalizeFilters({ book: 'f'.repeat(8) + BOOK_1.slice(8) }, catalog, DEFAULT_FILTERS).book, '');   // well-formed but unknown
  assert.equal(normalizeFilters({ source: 'x' }, catalog, DEFAULT_FILTERS).source, '');
  assert.equal(normalizeFilters({ book: BOOK_1, source: SRC_C }, catalog, DEFAULT_FILTERS).source, '');          // source of another book
  assert.equal(normalizeFilters({ source: SRC_C }, catalog, DEFAULT_FILTERS).source, SRC_C);                      // no book chosen: any source
  assert.equal(normalizeFilters({ q: 'x'.repeat(500) }, catalog, DEFAULT_FILTERS).search.length, 200);
  assert.equal(normalizeFilters({}, catalog, DEFAULT_FILTERS).search, '');
});

test('the list query carries only chosen filters and the cursor', () => {
  assert.deepEqual(listQuery(DEFAULT_FILTERS), { archive: 'active', limit: 50 });
  assert.deepEqual(listQuery({ search: 'x', book: BOOK_1, source: SRC_A, archive: 'archived' }, 'cur'), { search: 'x', book_id: BOOK_1, source_id: SRC_A, archive: 'archived', limit: 50, cursor: 'cur' });
});

test('counts are totals for the chosen scope and honest when they cannot be known', () => {
  assert.deepEqual(noteCounts(catalog, DEFAULT_FILTERS), { active: 5, archived: 1, approximate: false });
  assert.deepEqual(noteCounts(catalog, { ...DEFAULT_FILTERS, book: BOOK_2 }), { active: 2, archived: 0, approximate: false });
  assert.deepEqual(noteCounts(catalog, { ...DEFAULT_FILTERS, source: SRC_A }), { active: null, archived: null, approximate: false });
  assert.equal(noteCounts(buildCatalog([book()], false), DEFAULT_FILTERS).approximate, true);
  assert.equal(noteCounts(null, DEFAULT_FILTERS).active, null);
});

test('list items carry the kind, archive label, context status as text and the source', () => {
  const view = buildNotes({ items: [note(1), note(2, { kind: 'bookmark', context_status: 'none', quote_preview: '', note_preview: '', archived: true, source_id: SRC_C }), note(1, { annotation_id: NOTE_2, context_status: 'pending' })], next: 'c', filters: DEFAULT_FILTERS, catalog });
  assert.equal(view.rows[0].href, `#/notes/${NOTE_1}`);
  assert.deepEqual(view.rows.map(row => row.kind), ['Highlight', 'Bookmark', 'Highlight']);
  assert.deepEqual(view.rows.map(row => row.context), ['Context: ready', 'No context (bookmark)', 'Context: pending']);
  assert.equal(view.rows[1].archived, true);
  assert.equal(view.rows[0].source, 'Synthetic · EPUB');
  assert.equal(view.rows[1].source, 'Synthetic · MOBI');
  assert.equal(buildNotes({ items: [note(1, { context_status: 'unavailable' })], next: null, filters: DEFAULT_FILTERS, catalog }).rows[0].context, 'Context: unavailable');
  assert.equal(buildNotes({ items: [note(1, { context_status: 'none' })], next: null, filters: DEFAULT_FILTERS, catalog }).rows[0].context, 'Context: none');
  assert.equal(view.more, true);
  assert.equal(view.state, 'ready');
});

test('empty states differ for no notes, no match and the archive', () => {
  assert.equal(buildNotes({ items: [], next: null, filters: DEFAULT_FILTERS, catalog }).state, 'empty');
  assert.equal(buildNotes({ items: [], next: null, filters: { ...DEFAULT_FILTERS, search: 'zz' }, catalog }).state, 'no_match');
  assert.equal(buildNotes({ items: [], next: null, filters: { ...DEFAULT_FILTERS, archive: 'archived' }, catalog }).state, 'empty_archive');
});

function html(patch = {}) {
  const filters = { ...DEFAULT_FILTERS, ...patch.filters };
  const known = patch.catalog === undefined ? catalog : patch.catalog;
  return notesHtml(buildNotes({ items: patch.items ?? [note(1), note(2, { kind: 'bookmark', context_status: 'none', quote_preview: '', note_preview: '' })], next: patch.next ?? null, filters, catalog: known }));
}

test('the notes page has a heading with the active count, filters and an Active/Archived switch with counts', () => {
  const page = html();
  assert.match(page, /<h2>Notes <span class="count">5 active<\/span><\/h2>/);
  assert.match(page, /<form data-form="notes-filter" role="search">/);
  assert.match(page, /<input type="search" name="q"/);
  assert.match(page, /<select name="book"><option value="">All books<\/option>.*Other Book.*Synthetic Book/s);   // sorted by title
  assert.match(page, /<select name="source"><option value="">All files<\/option>/);
  assert.match(page, /data-action="notes-archive" data-value="active" aria-pressed="true">Active \(5\)/);
  assert.match(page, /data-action="notes-archive" data-value="archived" aria-pressed="false">Archived \(1\)/);
  assert.ok(!/ style=/.test(page));
});

test('the selected filters are shown as selected and the archive tab can be pressed', () => {
  const page = html({ filters: { search: 'dune', book: BOOK_1, archive: 'archived' } });
  assert.match(page, /value="dune"/);
  assert.match(page, /<option value="1{8}-[^"]+" selected>Synthetic Book/);
  assert.match(page, /aria-pressed="true">Archived \(1 in library\)/);   // a search is active: counts are library totals
  assert.match(page, /<option value="a{64}">Synthetic · EPUB<\/option>/);       // sources of the chosen book only
  assert.ok(!/<option value="c{64}"/.test(page));
  assert.match(html({ filters: { source: SRC_A } }), /<option value="a{64}" selected>/);
  assert.match(html({ filters: { source: SRC_A } }), /Active<\/button>/);       // no counts per file
  const approximate = html({ catalog: buildCatalog([book()], false) });
  assert.match(approximate, /<span class="count">≥ 3 active<\/span>/);
  assert.match(approximate, /Active \(≥ 3\)/);
});

test('list items escape user text and show text labels instead of colour', () => {
  const page = html({ items: [note(1, { quote_preview: '<img src=x onerror=alert(1)> Привет', note_preview: 'a & b "c"', archived: true })] });
  assert.ok(!page.includes('<img src=x'));
  assert.match(page, /&lt;img src=x onerror=alert\(1\)&gt; Привет/);
  assert.match(page, /a &amp; b &quot;c&quot;/);
  assert.match(page, /<span class="chip">Highlight<\/span>/);
  assert.match(page, /<span class="chip archived">Archived<\/span>/);
  assert.match(page, /Context: ready/);
  assert.match(page, new RegExp(`<a href="#/notes/${NOTE_1}">`));
  assert.match(page, /Synthetic · EPUB/);
});

test('every list item has the same structure whatever it contains', () => {
  const page = html({ items: [note(1), note(2, { kind: 'bookmark', context_status: 'none', quote_preview: '', note_preview: '' })] });
  const items = [...page.matchAll(/<li class="note-item">(.*?)<\/li>/gs)].map(match => match[1]);
  assert.equal(items.length, 2);
  const shape = item => [...item.matchAll(/class="([\w-]+)/g)].map(match => match[1]).filter(name => !['chip', 'archived'].includes(name)).join();
  assert.equal(shape(items[0]), shape(items[1]));
  assert.match(items[1], /No quoted text/);
  assert.match(items[1], /No note/);
});

test('paging and the empty and no-match states', () => {
  assert.match(html({ next: 'c' }), /<button type="button" data-action="notes-more">Show more<\/button>/);
  assert.ok(!/notes-more/.test(html()));
  assert.match(html({ items: [] }), /No notes yet/);
  assert.match(html({ items: [], filters: { search: 'zz' } }), /No notes match/);
  assert.match(html({ items: [], filters: { archive: 'archived' } }), /No archived notes/);
  assert.ok(!/class="count"/.test(html({ catalog: null })));                 // counts unknown: no invented number
  assert.ok(!/class="count"/.test(html({ filters: { source: SRC_A } })));
});

test('counts are labelled as library totals while a search is active', () => {
  const page = html({ filters: { search: 'dune' } });
  assert.match(page, /<span class="count">5 active in library<\/span>/);
  assert.match(page, /Active \(5 in library\)/);
  assert.match(page, /Archived \(1 in library\)/);
  assert.ok(!/in library/.test(html()));
});

test('filters that point at books or files that no longer exist are dropped', () => {
  const stale = { search: 'x', book: 'f'.repeat(8) + BOOK_1.slice(8), source: 'e'.repeat(64), archive: 'archived' };
  assert.deepEqual(reconcileFilters(stale, catalog), { search: 'x', book: '', source: '', archive: 'archived' });
  assert.deepEqual(reconcileFilters({ ...DEFAULT_FILTERS, book: BOOK_2, source: SRC_C }, catalog), { ...DEFAULT_FILTERS, book: BOOK_2, source: SRC_C });
});
