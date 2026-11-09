import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrary } from '../../projects/frontend/js/models/books.js';

const sha = char => char.repeat(64);
const source = (char, format, patch = {}) => ({ source_id: sha(char), format, title: 'T', authors: [], progress: null, last_opened_at: null, cover_available: false, ...patch });
const book = (patch = {}) => ({ book_id: 'b1', title: 'Synthetic <Book>', authors: ['A One', 'B Two'], sources: [source('a', 'epub'), source('b', 'pdf')],
  active_annotations: 4, archived_annotations: 1, most_recent_source_id: sha('b'), first_tracked_at: null, last_tracked_at: '2026-11-08T20:26:00Z', active_days: 3, ...patch });

test('a grouped book shows every format and the most recent source progress', () => {
  const sources = [source('a', 'epub'), source('b', 'pdf', { progress: { fraction: 0.425, position: {}, observed_at: 'x', session_id: 's' }, cover_available: true })];
  const library = buildLibrary({ books: [book({ sources })], search: '' });
  assert.equal(library.state, 'ready');
  const [card] = library.cards;
  assert.deepEqual(card.formats, ['EPUB', 'PDF']);
  assert.equal(card.authors, 'A One, B Two');
  assert.deepEqual(card.progress, { text: '43%', format: 'PDF', state: 'available' });
  assert.deepEqual(card.notes, { active: 4, archived: 1 });
  assert.equal(card.cover.url, `/api/v1/owner/sources/${sha('b')}/cover`);
  assert.equal(card.lastTracked, '8 Nov 2026, 20:26 UTC');
  assert.equal(card.href, '#/books/b1');
});

test('missing progress is not 0 percent and a missing cover falls back to an initial', () => {
  const [card] = buildLibrary({ books: [book({ title: 'élan', most_recent_source_id: null, last_tracked_at: null })], search: '' }).cards;
  assert.deepEqual(card.progress, { text: 'No progress recorded', format: null, state: 'unavailable' });
  assert.deepEqual(card.cover, { url: null, initial: 'É' });
  assert.equal(card.lastTracked, '');
  assert.equal(buildLibrary({ books: [book({ title: '' })], search: '' }).cards[0].cover.initial, '?');
});

test('a cover from another source is used when the latest source has none', () => {
  const sources = [source('a', 'epub', { cover_available: true }), source('b', 'pdf')];
  assert.match(buildLibrary({ books: [book({ sources })], search: '' }).cards[0].cover.url, new RegExp(sha('a')));
});

test('empty library and empty search results are different states', () => {
  assert.equal(buildLibrary({ books: [], search: '' }).state, 'empty');
  assert.equal(buildLibrary({ books: [], search: 'xyz' }).state, 'no_match');
});

test('a truncated listing is flagged', () => {
  assert.equal(buildLibrary({ books: [book()], search: '', complete: false }).truncated, true);
  assert.equal(buildLibrary({ books: [book()], search: '' }).truncated, false);
});
