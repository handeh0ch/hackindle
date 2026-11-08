import test from 'node:test';
import assert from 'node:assert/strict';
import { rings } from '../../public/js/rings.js';

const at = (x, y) => ({ x, y });

test('the hovered cell is ring 0 and its surroundings fall into rings 1 to 3 by distance', () => {
  const items = [at(100, 100), at(114, 100), at(114, 114), at(100, 86), at(128, 100), at(142, 100), at(128, 128), at(156, 100), at(100, 240)];
  assert.deepEqual(rings(at(100, 100), items, 14), [0, 1, 1, 1, 2, 3, 3, null, null]);
});

test('the radius can be narrowed and a different pitch scales the rings', () => {
  const items = [at(0, 0), at(10, 0), at(20, 0), at(30, 0)];
  assert.deepEqual(rings(at(0, 0), items, 10, 2), [0, 1, 2, null]);
  assert.deepEqual(rings(at(0, 0), items, 20, 3), [0, 1, 1, 1]);   // 30 / 20 = 1.5: still the first ring
});

test('cells that are not near the origin or not on the grid get no ring', () => {
  assert.deepEqual(rings(at(0, 0), [], 14), []);
  assert.deepEqual(rings(at(0, 0), [at(Infinity, 0), at(NaN, 0)], 14), [null, null]);
});
