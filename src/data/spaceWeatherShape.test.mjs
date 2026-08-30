// NOAA SWPC space-weather normalization. Two things carry real risk here: the
// OVATION grid arrives with 0–360 longitudes (unwrapped, half the aurora lands
// in the wrong hemisphere), and the Kp product appends rows over time (read the
// wrong end and you report a week-old index as current).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKp,
  parseAuroraGrid,
  parsePlanetaryKp,
  auroraStyle,
  KP_BANDS,
} from './spaceWeatherShape.js';

test('Kp bands are ordered, distinct, and each names an operational effect', () => {
  for (let i = 1; i < KP_BANDS.length; i += 1) {
    assert.ok(KP_BANDS[i].min > KP_BANDS[i - 1].min, 'thresholds ascend');
  }
  assert.equal(new Set(KP_BANDS.map((b) => b.label)).size, KP_BANDS.length);
  assert.equal(new Set(KP_BANDS.map((b) => b.css)).size, KP_BANDS.length);
  for (const band of KP_BANDS) {
    assert.ok(band.effect.length > 10, `${band.label} must say what it means operationally`);
  }
});

test('classifyKp maps an index onto its band', () => {
  assert.equal(classifyKp(0).label, 'QUIET');
  assert.equal(classifyKp(3).label, 'QUIET');
  assert.equal(classifyKp(4).label, 'UNSETTLED');
  assert.equal(classifyKp(5).label, 'G1 STORM');
  assert.equal(classifyKp(7).label, 'G3 STORM');
  assert.equal(classifyKp(9).label, 'G5 STORM');
});

test('an unavailable index is UNKNOWN, never quiet', () => {
  // "No data" rendered as "all clear" is the dangerous direction to fail in.
  for (const input of [null, undefined, NaN, 'nonsense']) {
    const band = classifyKp(input);
    assert.equal(band.label, 'UNKNOWN');
    assert.equal(band.kp, null);
    assert.notEqual(band.label, 'QUIET');
  }
});

test('out-of-range indices clamp rather than falling off the scale', () => {
  assert.equal(classifyKp(-5).label, 'QUIET');
  assert.equal(classifyKp(99).label, 'G5 STORM');
  assert.equal(classifyKp(99).kp, 9);
});

test('LONGITUDE WRAP: the 0–360 grid is converted to −180…180', () => {
  // Unwrapped, everything east of the prime meridian lands on the wrong side
  // of the globe.
  const { points } = parseAuroraGrid({
    coordinates: [[0, 60, 50], [90, 60, 50], [190, 60, 50], [359, 60, 50]],
  });
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  assert.deepEqual(lons, [-170, -1, 0, 90]);
  assert.ok(points.every((p) => p.lon >= -180 && p.lon <= 180));
});

test('the near-empty grid is filtered before it reaches the renderer', () => {
  // SWPC ships ~65k points on a 1x1 degree grid, almost all of them zero.
  const coordinates = [];
  for (let lon = 0; lon < 360; lon += 1) coordinates.push([lon, 0, 0]);
  coordinates.push([10, 70, 45], [11, 70, 60]);
  const { points, dropped } = parseAuroraGrid({ coordinates });
  assert.equal(points.length, 2, 'only points above the threshold survive');
  assert.equal(dropped, 360);
});

test('the grid is ordered brightest-first so a cap keeps the oval, not its fringe', () => {
  const coordinates = [[0, 60, 10], [1, 60, 90], [2, 60, 50]];
  const { points, peak } = parseAuroraGrid({ coordinates }, { maxPoints: 2 });
  assert.deepEqual(points.map((p) => p.probability), [90, 50]);
  assert.equal(peak, 90);
});

test('OVATION timestamps are carried through so the layer can date its forecast', () => {
  const parsed = parseAuroraGrid({
    'Observation Time': '2026-08-30T12:00:00Z',
    'Forecast Time': '2026-08-30T13:00:00Z',
    coordinates: [[0, 70, 40]],
  });
  assert.equal(parsed.observedAt, '2026-08-30T12:00:00Z');
  assert.equal(parsed.forecastAt, '2026-08-30T13:00:00Z');
});

test('a malformed aurora payload yields an empty grid rather than throwing', () => {
  for (const input of [null, {}, { coordinates: null }, { coordinates: [[1, 2]] }, { coordinates: ['x'] }]) {
    const parsed = parseAuroraGrid(input);
    assert.deepEqual(parsed.points, []);
    assert.equal(parsed.peak, 0);
  }
});

test('junk rows inside a good grid are skipped, not fatal', () => {
  const { points } = parseAuroraGrid({
    coordinates: [[0, 70, 40], null, [NaN, 70, 40], [10, 999, 40], 'junk', [20, 70, 40]],
  });
  assert.equal(points.length, 2);
});

test('LATEST ROW: the Kp product appends over time, so the last row is current', () => {
  const payload = [
    ['time_tag', 'Kp', 'a_running', 'station_count'],
    ['2026-08-23T00:00:00', '2.00', '7', '8'],
    ['2026-08-29T21:00:00', '7.33', '48', '8'],
  ];
  const { kp, timeTag } = parsePlanetaryKp(payload);
  assert.ok(Math.abs(kp - 7.33) < 1e-9, 'reading the first row would report a week-old index');
  assert.equal(timeTag, '2026-08-29T21:00:00');
});

test('Kp parsing finds its columns by header name, not by fixed position', () => {
  const payload = [
    ['time_tag', 'station_count', 'Kp'],
    ['2026-08-29T21:00:00', '8', '5.67'],
  ];
  assert.ok(Math.abs(parsePlanetaryKp(payload).kp - 5.67) < 1e-9);
});

test('Kp parsing skips trailing rows with no usable value', () => {
  const payload = [
    ['time_tag', 'Kp'],
    ['2026-08-29T18:00:00', '4.00'],
    ['2026-08-29T21:00:00', ''],
    ['2026-08-30T00:00:00', 'null'],
  ];
  assert.equal(parsePlanetaryKp(payload).kp, 4);
});

test('a malformed Kp payload reports no index rather than guessing one', () => {
  for (const input of [null, [], [['time_tag', 'Kp']], 'nope', [{}]]) {
    assert.deepEqual(parsePlanetaryKp(input), { kp: null, timeTag: null });
  }
});

test('aurora styling scales with probability and vanishes at zero', () => {
  const zero = auroraStyle(0);
  assert.equal(zero.pixelSize, 0);
  assert.equal(zero.alpha, 0);
  const weak = auroraStyle(10);
  const strong = auroraStyle(95);
  assert.ok(weak.alpha < strong.alpha);
  assert.ok(weak.pixelSize < strong.pixelSize);
  assert.notEqual(weak.css, strong.css, 'intensity shifts colour, as real aurora does');
  assert.equal(auroraStyle(NaN).pixelSize, 0);
});
