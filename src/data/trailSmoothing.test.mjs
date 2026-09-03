// src/data/trailSmoothing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { smoothTrailPositions, MAX_SMOOTH_SEGMENT_M } from './trailSmoothing.js';

const P = (x, y, z) => new Cesium.Cartesian3(x, y, z);

/** Every element of `positions` must reappear in `out`, in the same relative
 *  order, as the exact same value (smoothing only inserts, never alters). */
function assertRealPointsPreserved(out, positions) {
  let cursor = 0;
  for (const real of positions) {
    while (cursor < out.length && !Cesium.Cartesian3.equals(out[cursor], real)) cursor++;
    assert.ok(cursor < out.length, 'a real fix is missing from the smoothed output');
    cursor++;
  }
}

test('fewer than 3 points: passthrough, unchanged', () => {
  assert.deepEqual(smoothTrailPositions([]), []);
  const one = [P(1, 2, 3)];
  assert.deepEqual(smoothTrailPositions(one), one);
  const two = [P(1, 2, 3), P(4, 5, 6)];
  assert.deepEqual(smoothTrailPositions(two), two);
});

test('every real fix is preserved exactly, in order', () => {
  const positions = [
    P(0, 0, 0), P(1000, 0, 0), P(1000, 1000, 0), P(2000, 1200, 0), P(2500, 900, 0),
  ];
  const out = smoothTrailPositions(positions);
  assertRealPointsPreserved(out, positions);
  // Real points are the same object references, not clones.
  for (const real of positions) assert.ok(out.includes(real));
});

test('smoothing only inserts points: output is at least as long as input', () => {
  const positions = [P(0, 0, 0), P(500, 0, 0), P(500, 500, 0), P(0, 500, 0)];
  const out = smoothTrailPositions(positions);
  assert.ok(out.length >= positions.length);
});

test('collinear, evenly spaced points stay perfectly straight (no fabricated bow)', () => {
  const positions = [P(0, 0, 0), P(1000, 0, 0), P(2000, 0, 0), P(3000, 0, 0)];
  const out = smoothTrailPositions(positions);
  for (const p of out) {
    assert.ok(Math.abs(p.y) < 1e-6, `collinear input produced off-axis y=${p.y}`);
    assert.ok(Math.abs(p.z) < 1e-6, `collinear input produced off-axis z=${p.z}`);
  }
});

test('a sharp turn curves smoothly but stays close to the real corner', () => {
  // A -> B -> C: a 90° corner, deliberately extreme (a real turning aircraft
  // sends several fixes across a turn this sharp, not one). B must still
  // land exactly on the real vertex, but the samples approaching/leaving it
  // must visibly deviate off the raw straight chords (that's the point of
  // smoothing) while staying close to the corner — bounded well under the
  // segment length, not a wild, "ridiculous" excursion.
  const a = P(0, 0, 0);
  const b = P(1000, 0, 0);
  const c = P(1000, 1000, 0);
  const out = smoothTrailPositions([a, b, c]);

  const bIndex = out.findIndex((p) => Cesium.Cartesian3.equals(p, b));
  assert.ok(bIndex > 1, 'expected interior samples before the B vertex');
  const lastBeforeB = out[bIndex - 1];
  const deviationFromChord = Math.abs(lastBeforeB.y); // raw A-B chord has y=0
  assert.ok(deviationFromChord > 1, 'expected a visible deviation off the straight A-B chord');
  assert.ok(
    deviationFromChord < 0.2 * Cesium.Cartesian3.distance(a, b),
    `deviation ${deviationFromChord} should stay well under the segment length (bounded, not a wild excursion)`,
  );
});

test('segments longer than MAX_SMOOTH_SEGMENT_M are left as a straight chord', () => {
  const far = MAX_SMOOTH_SEGMENT_M + 500;
  const positions = [P(0, 0, 0), P(far, 0, 0), P(far, 500, 0)];
  const out = smoothTrailPositions(positions);
  // No interior points between the first two (over-cap) fixes.
  const aIdx = out.findIndex((p) => Cesium.Cartesian3.equals(p, positions[0]));
  const bIdx = out.findIndex((p) => Cesium.Cartesian3.equals(p, positions[1]));
  assert.equal(bIdx, aIdx + 1, 'an over-cap segment should have no interior samples');
});

test('degenerate zero-length segment is passed through without dividing by zero', () => {
  const positions = [P(0, 0, 0), P(1000, 0, 0), P(1000, 0, 0), P(2000, 500, 0)];
  assert.doesNotThrow(() => smoothTrailPositions(positions));
});

test('a custom maxSamplesPerSegment bounds interior point count', () => {
  const positions = [P(0, 0, 0), P(3000, 0, 0), P(3000, 3000, 0)];
  const out = smoothTrailPositions(positions, { maxSamplesPerSegment: 2 });
  // 2 segments, each capped at 2 interior samples, plus 3 real points.
  assert.ok(out.length <= 3 + 2 * 2);
});
