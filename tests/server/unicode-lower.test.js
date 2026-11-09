import test from 'node:test';
import assert from 'node:assert/strict';
import { lower, UNICODE_VERSION } from '../../projects/server/text/unicode-lower.js';
import { vocabularyIdentity } from '../../projects/server/text/vocabulary-identity.js';

test('frozen lowercase handles special mappings and final sigma', () => {
  assert.equal(lower('ΟΔΥΣΣΕΥΣ'), 'οδυσσευς');
  assert.equal(lower('Σ'), 'σ');
  assert.equal(lower('İ'), 'i̇');
  assert.equal(lower('ABC\u{10400}'), 'abc\u{10428}');
  assert.equal(lower('\ud800x'), '\ud800x');
});

test('frozen lowercase matches the runtime while the Unicode versions agree', { skip: process.versions.unicode !== UNICODE_VERSION }, () => {
  for (let n = 0; n <= 0x10ffff; n++) {
    if (n >= 0xd800 && n <= 0xdfff) continue;
    const char = String.fromCodePoint(n);
    assert.equal(lower(char), char.toLowerCase(), `U+${n.toString(16)}`);
  }
  for (const word of ['ΑΣ', 'ΑΣ.', 'Α.Σ', 'ΑΣΑ', 'Σ', 'ΑΣ́']) assert.equal(lower(word), word.toLowerCase());
});

test('vocabulary identity lowercases word and language independently of the runtime', () => {
  assert.deepEqual(vocabularyIdentity({ word: 'Ünï', language: 'EN' }), ['ünï', 'en']);
  assert.deepEqual(vocabularyIdentity({ word: 'X', language: null }), ['x', null]);
  assert.deepEqual(vocabularyIdentity({ word: 'X' }), ['x', null]);
});
