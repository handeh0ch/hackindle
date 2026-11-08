// Grouping: uncertain matches (confirm / keep separate), merge and split. Nothing here deletes data;
// every change can be undone with the opposite action. Forms start disabled until confirmed.
import { isUuid, isSourceId } from './ids.js';
import { esc } from './views.js';
import { sourceTabs } from './book.js';
import { setFlash, guarded, errorText, gateOpen } from './flow.js';

const LABELS = {
  nothing_to_split: "Nothing to split: choose some of this book's files, not all of them",
  already_grouped: 'That file is already in that book',
  book_not_found: 'That book no longer exists',
  source_not_found: 'That file no longer exists',
};

export function buildMatches({ matches, catalog }) {
  return matches.map(item => ({
    sourceName: catalog?.sources.has(item.source_id) ? `${catalog.sources.get(item.source_id).title} · ${catalog.sources.get(item.source_id).format}` : 'Unknown file',
    currentBook: catalog?.sources.get(item.source_id)?.bookTitle ?? 'Unknown book',
    candidate: catalog?.books.find(entry => entry.id === item.candidate_book_id)?.title ?? 'Unknown book',
    reason: String(item.reason).replace(/_/g, ' '),
    confirm: `${item.source_id}|${item.candidate_book_id}|confirm`, reject: `${item.source_id}|${item.candidate_book_id}|reject`,
  }));
}

export function matchesHtml(rows) {
  if (!rows.length) return '<p class="state">No uncertain matches. Files that might be the same book as another one will be offered here.</p>';
  const items = rows.map(row => `<li class="match"><p><strong>${esc(row.sourceName)}</strong> (now in “${esc(row.currentBook)}”) may be the same book as “${esc(row.candidate)}” — ${esc(row.reason)}.</p>`
    + `<div class="actions"><button type="button" data-action="match" data-value="${esc(row.confirm)}">Confirm same book</button><button type="button" data-action="match" data-value="${esc(row.reject)}">Keep separate</button></div></li>`);
  return `<p class="note">Confirm puts the file into the other book. Keep separate stops this suggestion. Nothing is deleted; you can merge or split books again later.</p><ul class="matches">${items.join('')}</ul>`;
}

const gateFields = '<label class="check"><input type="checkbox" name="ack" required> I understand that this changes how my books are grouped.</label>';
const sourceChecks = (book, checked) => sourceTabs(book, null).map((tab, index) => {
  const item = book.sources[index];
  return `<label class="check"><input type="checkbox" name="src-${index}" value="${esc(tab.id)}"${checked ? ' checked' : ''}> ${esc(tab.label)} — ${esc(item.title || book.title)} (${esc(tab.progress)} read)</label>`;
}).join('');

export function splitFormHtml(book) {
  if (book.sources.length < 2) return '<div class="group-box"><h4>Split</h4><p class="note">This book has only one file, so there is nothing to split.</p></div>';
  return '<form data-form="group-split" data-gate="ack" class="group-box"><h4>Split this book</h4>'
    + '<p class="note">The files you tick move into a new book; the others stay here. Nothing is deleted: notes, positions and reading history stay with each file, and you can merge the books again.</p>'
    + `<input type="hidden" name="book" value="${esc(book.book_id)}"><fieldset><legend>Files to move</legend>${sourceChecks(book, false)}</fieldset>${gateFields}<button type="submit" data-gated disabled>Split into a new book</button></form>`;
}

export function mergeFormHtml(book, catalog) {
  const others = (catalog?.books ?? []).filter(entry => entry.id !== book.book_id).sort((a, b) => a.title.localeCompare(b.title));
  if (!others.length) return '<div class="group-box"><h4>Merge</h4><p class="note">There are no other books to merge into.</p></div>';
  return '<form data-form="group-merge" data-gate="ack" class="group-box"><h4>Merge into another book</h4>'
    + '<p class="note">The files you tick move into the chosen book. Nothing is deleted: notes, positions and reading history stay with each file. If you move every file, this book page disappears; a later split creates a new page.</p>'
    + `<input type="hidden" name="book" value="${esc(book.book_id)}"><label>Merge into<select name="target" required><option value="">Choose a book</option>${others.map(entry => `<option value="${esc(entry.id)}">${esc(entry.title)}</option>`).join('')}</select></label>`
    + `<fieldset><legend>Files to move</legend>${sourceChecks(book, true)}</fieldset>${gateFields}<button type="submit" data-gated disabled>Merge</button></form>`;
}

export function bookGroupingHtml(book, matches, catalog) {
  const relevant = matches.filter(item => item.candidate_book_id === book.book_id || book.sources.some(entry => entry.source_id === item.source_id));
  return '<section aria-labelledby="grouping-title"><h3 id="grouping-title">Grouping</h3>'
    + `${matchesHtml(buildMatches({ matches: relevant, catalog }))}${splitFormHtml(book)}${mergeFormHtml(book, catalog)}</section>`;
}

export function groupingSection(rows) {
  return `<section aria-labelledby="grouping-title"><h3 id="grouping-title">Grouping</h3>${matchesHtml(rows)}</section>`;
}

// Source ids from fields src-0, src-1, ...; null when any value is not a source id.
function pickedSources(values) {
  const ids = Object.entries(values).filter(([key]) => /^src-\d+$/.test(key)).map(([, value]) => value);
  return ids.every(isSourceId) ? [...new Set(ids)] : null;
}

// Sends one grouping change, then shows a message on the page it reloads or opens.
async function change(ctx, navigate, request, { done, next, failed }) {
  const result = await guarded(ctx, navigate, request);
  if (result.handled) return undefined;
  if (!result.ok) {
    setFlash(ctx, 'alert', errorText(failed, result.error, LABELS));
    return navigate(ctx.hash, { focus: '#flash' });
  }
  setFlash(ctx, 'status', done);
  let target = null;
  try { target = next(result.value); } catch { /* an unexpected answer shape must not stop the reload */ }
  return navigate(isUuid(target) ? `#/books/${target}` : ctx.hash, { focus: '#flash' });
}

export const groupingActions = {
  actions: {
    async match(ctx, value, { navigate }) {
      const [sourceId, bookId, decision] = String(value ?? '').split('|');
      if (!isSourceId(sourceId) || !isUuid(bookId) || (decision !== 'confirm' && decision !== 'reject')) return undefined;
      const confirm = decision === 'confirm';
      return change(ctx, navigate, () => ctx.api.send('POST', '/owner/matches', { source_id: sourceId, book_id: bookId, decision }), {
        failed: 'Could not save the decision', next: book => confirm ? book.book_id : null,
        done: confirm ? 'Grouped: the file now belongs to the other book.' : 'Kept separate: this suggestion will not be offered again.' });
    },
  },
  forms: {
    async 'group-split'(ctx, values, { navigate }) {
      const sources = pickedSources(values);
      if (!gateOpen('ack', values) || !isUuid(values.book) || sources === null) return undefined;
      if (!sources.length) { setFlash(ctx, 'alert', 'Choose at least one file to move.'); return navigate(ctx.hash, { focus: '#flash' }); }
      return change(ctx, navigate, () => ctx.api.send('POST', `/owner/books/${encodeURIComponent(values.book)}/split`, { source_ids: sources }), {
        failed: 'Could not split the book', done: 'Split done: the chosen files are now in a new book.',
        next: result => (result.items.find(item => item.book_id !== values.book) ?? result.items[0])?.book_id });
    },
    async 'group-merge'(ctx, values, { navigate }) {
      const sources = pickedSources(values);
      if (!gateOpen('ack', values) || !isUuid(values.book) || !isUuid(values.target) || values.target === values.book || sources === null) return undefined;
      if (!sources.length) { setFlash(ctx, 'alert', 'Choose at least one file to move.'); return navigate(ctx.hash, { focus: '#flash' }); }
      return change(ctx, navigate, () => ctx.api.send('POST', '/owner/books/merge', { source_ids: sources, target_book_id: values.target }), {
        failed: 'Could not merge the books', done: 'Merged: the chosen files are now in the other book.', next: () => values.target });
    },
  },
};
