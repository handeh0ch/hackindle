import test from 'node:test';
import assert from 'node:assert/strict';
import { placeTip } from '../../public/js/tooltip.js';

const viewport = { width: 800, height: 600 };
const tip = { width: 120, height: 32 };
const anchor = (left, top) => ({ left, top, width: 11, height: 11 });

test('the tooltip sits above the target, centred on it', () => {
  const placed = placeTip({ anchor: anchor(400, 300), tip, viewport });
  assert.equal(placed.placement, 'above');
  assert.equal(placed.left, 400 + 5.5 - 60);
  assert.equal(placed.top, 300 - 32 - 8);
  assert.equal(placed.arrow, 60);
});

test('it flips below when there is no room above', () => {
  const placed = placeTip({ anchor: anchor(400, 20), tip, viewport });
  assert.deepEqual([placed.placement, placed.top], ['below', 20 + 11 + 8]);
});

test('it stays inside the viewport and the arrow keeps pointing at the target', () => {
  const left = placeTip({ anchor: anchor(2, 300), tip, viewport });
  assert.equal(left.left, 8);
  assert.equal(left.arrow, 12);                                   // clamped inside the rounded corner
  const right = placeTip({ anchor: anchor(790, 300), tip, viewport });
  assert.equal(right.left, 800 - 120 - 8);
  assert.equal(right.arrow, 120 - 12);
  const wide = placeTip({ anchor: anchor(100, 300), tip: { width: 900, height: 32 }, viewport });
  assert.equal(wide.left, 8);                                     // wider than the screen: align to the left margin
});
