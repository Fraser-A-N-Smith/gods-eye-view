// Strict coercion for external feed values. Every case here is one this repo
// has actually been bitten by: Number() turns absence into zero, which turns
// "the feed did not say" into "the feed said none".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finiteOrNull, textOrNull, clampedOrNull } from './numeric.js';

test('ABSENCE IS NOT ZERO — the bug this module exists to prevent', () => {
  // Every one of these is 0 under a bare Number().
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull(undefined), null);
  assert.equal(finiteOrNull(''), null);
  assert.equal(finiteOrNull('   '), null);
  assert.equal(finiteOrNull([]), null);
  assert.equal(finiteOrNull(false), null);
});

test('a genuine zero survives', () => {
  // The whole point is telling these apart from the cases above.
  assert.equal(finiteOrNull(0), 0);
  assert.equal(finiteOrNull('0'), 0);
  assert.equal(finiteOrNull('0.0'), 0);
});

test('real numbers pass through, in either type', () => {
  assert.equal(finiteOrNull(42), 42);
  assert.equal(finiteOrNull('42'), 42);
  assert.equal(finiteOrNull(' 7.33 '), 7.33);
  assert.equal(finiteOrNull(-1.5), -1.5);
});

test('non-numeric and non-finite values are null', () => {
  assert.equal(finiteOrNull('nonsense'), null);
  assert.equal(finiteOrNull(NaN), null);
  assert.equal(finiteOrNull(Infinity), null);
  assert.equal(finiteOrNull(-Infinity), null);
  assert.equal(finiteOrNull({}), null);
});

test('a boolean where a measurement belongs is malformed, not one', () => {
  assert.equal(finiteOrNull(true), null, 'Number(true) is 1 — a flag is not a reading');
  assert.equal(finiteOrNull(false), null);
});

test('textOrNull trims and treats blank as absent', () => {
  assert.equal(textOrNull('  PARK FIRE '), 'PARK FIRE');
  assert.equal(textOrNull(''), null);
  assert.equal(textOrNull('   '), null);
  assert.equal(textOrNull(null), null);
  assert.equal(textOrNull(undefined), null);
  assert.equal(textOrNull(0), '0', 'a real zero stringifies rather than vanishing');
});

test('clampedOrNull bounds a value but keeps absence absent', () => {
  assert.equal(clampedOrNull(5, 0, 9), 5);
  assert.equal(clampedOrNull(-3, 0, 9), 0);
  assert.equal(clampedOrNull(99, 0, 9), 9);
  assert.equal(clampedOrNull(null, 0, 9), null, 'clamping must not manufacture a floor value');
  assert.equal(clampedOrNull('', 0, 9), null);
});
