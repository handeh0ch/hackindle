// HTML for the notes list and one note. Quotes, notes and context pages are user text: everything goes
// through esc() and is shown as plain text (CSS keeps line breaks and wraps long words).
import { esc, stateHtml } from './views.js';

const EMPTY = { empty: 'No notes yet for this selection. Highlights and bookmarks appear after the plugin syncs.', empty_archive: 'No archived notes. A highlight deleted on the device moves here.' };

function itemHtml(row) {
  const quote = row.quote ? `<blockquote class="quote clamp">${esc(row.quote)}</blockquote>` : '<blockquote class="quote clamp muted">No quoted text</blockquote>';
  const note = row.note ? `<p class="note-body clamp">${esc(row.note)}</p>` : '<p class="note-body clamp muted">No note</p>';
  return `<li class="note-item"><div class="meta"><span class="chip">${esc(row.kind)}</span>${row.archived ? '<span class="chip archived">Archived</span>' : ''}<span class="from">${esc(row.source)}</span></div>`
    + `${quote}${note}<p class="ctx">${esc(row.context)}</p><a href="${esc(row.href)}">Open note</a></li>`;
}

const options = (items, first) => `<option value="">${first}</option>${items.map(item => `<option value="${esc(item.id)}"${item.selected ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}`;

export function notesHtml(view) {
  const heading = `<h2>Notes${view.heading ? ` <span class="count">${esc(view.heading)}</span>` : ''}</h2>`;
  const form = `<form data-form="notes-filter" role="search"><label>Search<input type="search" name="q" value="${esc(view.filters.search)}" placeholder="Search quotes and notes"></label>`
    + `<label>Book<select name="book">${options(view.books, 'All books')}</select></label><label>File<select name="source">${options(view.files, 'All files')}</select></label><button type="submit">Apply</button></form>`;
  const tabs = `<div class="toolbar tabs" role="group" aria-label="Notes archive">${view.tabs.map(tab => `<button type="button" data-action="notes-archive" data-value="${tab.value}" aria-pressed="${tab.pressed}">${esc(tab.label)}</button>`).join('')}</div>`;
  const body = view.state === 'ready' ? `<ul class="notes">${view.rows.map(itemHtml).join('')}</ul>${view.more ? '<button type="button" data-action="notes-more">Show more</button>' : ''}`
    : stateHtml('empty', view.state === 'no_match' ? `No notes match "${view.filters.search}".` : EMPTY[view.state]);
  return `${heading}${form}${tabs}${body}`;
}

function pageHtml(page) {
  return `<article class="ctx-page ${page.role}"><h4>${esc(page.heading)}</h4>`
    + (page.blank ? '<p class="page-text blank">Blank page</p>' : `<p class="page-text">${esc(page.text)}</p>`) + '</article>';
}

function contextHtml(context) {
  if (context.status === 'none') return stateHtml('empty', context.text);
  if (context.status === 'invalid') return stateHtml('alert', 'The saved context could not be read. The quote and note above are unaffected.');
  if (context.status !== 'ready') return `<p class="state" role="status"><strong>Context ${esc(context.status)}</strong><br>${esc(context.reason)}</p>`;
  return `<p class="note">${esc(context.origin)}. ${esc(context.basis)}; captured ${esc(context.captured)}.</p>`
    + (context.boundaryBefore ? `<p class="edge">${esc(context.boundaryBefore)}</p>` : '') + context.pages.map(pageHtml).join('')
    + (context.boundaryAfter ? `<p class="edge">${esc(context.boundaryAfter)}</p>` : '');
}

export function noteDetailHtml(model) {
  const source = model.source.bookHref ? `<a href="${esc(model.source.bookHref)}">${esc(model.source.name)}</a>` : esc(model.source.name);
  const quote = model.quote ? `<blockquote class="quote">${esc(model.quote)}</blockquote>` : '<blockquote class="quote muted">No quoted text</blockquote>';
  const note = model.note ? `<p class="note-body">${esc(model.note)}</p>` : '<p class="note-body muted">No note</p>';
  return `<p class="crumb"><a href="#/notes">Back to notes</a></p><h2>Note</h2>`
    + `<div class="meta"><span class="chip">${esc(model.kind)}</span>${model.archived ? '<span class="chip archived">Archived</span>' : ''}<span class="from">${source}</span></div>`
    + `<section aria-labelledby="quote-title"><h3 id="quote-title">Quote</h3>${quote}</section><section aria-labelledby="note-title"><h3 id="note-title">Your note</h3>${note}</section>`
    + `<section aria-labelledby="context-title"><h3 id="context-title">Context</h3>${contextHtml(model.context)}</section>`;
}
