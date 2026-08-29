// Fire perimeters layer. The presentation rules here are all about not
// overclaiming: unknown containment is its own state rather than being painted
// as either extreme, an unmapped region is not an unburned one, and a
// truncated set says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  containmentStyle,
  formatAcres,
  ringCentroid,
  perimeterStatusText,
} from './firePerimeters.js';

test('containment drives the colour, and unknown gets its OWN colour', () => {
  const unknown = containmentStyle(null);
  const uncontained = containmentStyle(0);
  const contained = containmentStyle(95);
  assert.equal(unknown.label, 'CONTAINMENT UNKNOWN');
  // Painting unknown as uncontained is a claim; as contained it is a dangerous one.
  assert.notEqual(unknown.css, uncontained.css);
  assert.notEqual(unknown.css, contained.css);
  assert.equal(containmentStyle(undefined).label, 'CONTAINMENT UNKNOWN');
  assert.equal(containmentStyle(NaN).label, 'CONTAINMENT UNKNOWN');
});

test('containment bands are ordered and distinct', () => {
  const bands = [0, 25, 60, 95].map((pct) => containmentStyle(pct).css);
  assert.equal(new Set(bands).size, 4, 'each band reads differently at a glance');
  assert.equal(containmentStyle(42).label, '42% CONTAINED');
  assert.equal(containmentStyle(42.6).label, '43% CONTAINED');
});

test('acreage formats compactly and admits when it is unknown', () => {
  assert.equal(formatAcres(429_603), '430K ACRES');
  assert.equal(formatAcres(1_250_000), '1.25M ACRES');
  assert.equal(formatAcres(842), '842 ACRES');
  assert.equal(formatAcres(null), 'SIZE UNKNOWN');
  assert.equal(formatAcres(NaN), 'SIZE UNKNOWN');
});

test('a zero-acre fire is reported as zero, not as unknown', () => {
  // The two are different facts and the distinction survives formatting.
  assert.equal(formatAcres(0), '0 ACRES');
});

test('ringCentroid averages the ring and tolerates junk points', () => {
  const centre = ringCentroid([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  assert.ok(Math.abs(centre.lon - 0.8) < 1e-9);
  assert.ok(Math.abs(centre.lat - 0.8) < 1e-9);
  const withJunk = ringCentroid([[0, 0], null, ['x', 'y'], [2, 2]]);
  assert.deepEqual(withJunk, { lon: 1, lat: 1 });
  assert.equal(ringCentroid([]), null);
  assert.equal(ringCentroid(null), null);
});

test('STATUS: an empty result says "no mapped perimeters", never "no fires"', () => {
  // The source maps US interagency incidents. Nothing drawn elsewhere means
  // nothing MAPPED there, which is not the same claim.
  const text = perimeterStatusText({ count: 0 });
  assert.equal(text, 'NO MAPPED PERIMETERS');
  assert.doesNotMatch(text, /NO FIRES/);
});

test('STATUS: coverage is always named so the map is not read as global', () => {
  const text = perimeterStatusText({ count: 12 });
  assert.match(text, /12 PERIMETERS/);
  assert.match(text, /US INTERAGENCY COVERAGE/);
});

test('STATUS: a truncated set reports the real upstream count', () => {
  const text = perimeterStatusText({ count: 600, truncated: true, totalFeatures: 1420 });
  assert.match(text, /600 PERIMETERS/);
  assert.match(text, /OF 1420 — LARGEST SHOWN/);
});

test('STATUS: an untruncated set does not mention truncation', () => {
  const text = perimeterStatusText({ count: 40, truncated: false, totalFeatures: 40 });
  assert.doesNotMatch(text, /LARGEST SHOWN/);
});

test('STATUS: errors and loading take priority over the count', () => {
  assert.equal(perimeterStatusText({ count: 5, error: 'PERIMETER FEED UNAVAILABLE' }), 'PERIMETER FEED UNAVAILABLE');
  assert.equal(perimeterStatusText({ count: 0, loading: true }), 'LOADING PERIMETERS');
});
