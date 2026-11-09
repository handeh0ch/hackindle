import { lower } from './unicode-lower.js';
export const vocabularyIdentity = word => [lower(word.word), word.language == null ? null : lower(word.language)];
