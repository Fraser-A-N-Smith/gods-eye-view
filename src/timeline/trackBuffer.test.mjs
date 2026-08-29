// TrackBuffer — the storage half of the timeline scrubber. The tests that
// matter here are the three refusals: no clamping outside the recorded range,
// no interpolation across a real feed gap, and no reordering of history. Each
// one is the difference between replaying what was observed and drawing a
// confident line through what was not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TrackBuffer,
  toSample,
  lerpLongitude,
  lerpHeading,
} from './trackBuffer.js';

const t0 = 1_700_000_000_000;

/** Two aircraft records in the analyst-record shape flights.js emits. */
function flight(id, lon, lat, extra = {}) {
  return { id, icao24: id, lon, lat, altitudeM: 10_000, heading: 90, ...extra };
}

test('toSample normalizes the per-layer record shapes onto one sample', () => {
  const air = toSample(flight('abc123', 10, 20));
  assert.equal(air.id, 'abc123');
  assert.equal(air.lon, 10);
  assert.equal(air.alt, 10_000);
  assert.equal(air.heading, 90);

  // Vessels carry courseDeg and no altitude — both must land on the same shape.
  const ship = toSample({ id: 'EVER GIVEN', mmsi: '353136000', lon: 4, lat: 51, courseDeg: 270 });
  assert.equal(ship.id, '353136000', 'mmsi is the key, the name is the label');
  assert.equal(ship.label, 'EVER GIVEN');
  assert.equal(ship.heading, 270);
  assert.equal(ship.alt, 0);

  // Quakes and fires carry neither heading nor altitude.
  const quake = toSample({ id: 'us7000abcd', lon: -120, lat: 36 });
  assert.equal(quake.heading, null);
  assert.equal(quake.alt, 0);
});

test('toSample rejects records with no usable position', () => {
  assert.equal(toSample(null), null);
  assert.equal(toSample({ id: 'x' }), null, 'no coordinates');
  assert.equal(toSample({ id: 'x', lon: NaN, lat: 5 }), null);
  assert.equal(toSample({ id: 'x', lon: 999, lat: 5 }), null, 'out-of-range longitude');
  assert.equal(toSample({ id: 'x', lon: 5, lat: -91 }), null, 'out-of-range latitude');
});

test('heading normalizes into [0,360) rather than carrying raw feed values', () => {
  assert.equal(toSample(flight('a', 0, 0, { heading: -90 })).heading, 270);
  assert.equal(toSample(flight('a', 0, 0, { heading: 450 })).heading, 90);
});

test('append stores frames and range reports the observed extent', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, { flights: [flight('a', 0, 0)] });
  buffer.append(t0 + 10_000, { flights: [flight('a', 1, 0)] });
  const range = buffer.range();
  assert.equal(range.startMs, t0);
  assert.equal(range.endMs, t0 + 10_000);
  assert.equal(range.frameCount, 2);
});

test('an out-of-order frame is refused, never silently reordered', () => {
  const buffer = new TrackBuffer();
  assert.equal(buffer.append(t0 + 10_000, { flights: [flight('a', 0, 0)] }), true);
  assert.equal(buffer.append(t0, { flights: [flight('a', 5, 5)] }), false);
  assert.equal(buffer.frameCount, 1);
});

test('REFUSAL: sampleAt outside the recorded range returns null, it does not clamp', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, { flights: [flight('a', 0, 0)] });
  buffer.append(t0 + 10_000, { flights: [flight('a', 1, 0)] });
  assert.equal(buffer.sampleAt(t0 - 1), null, 'before the first observation');
  assert.equal(buffer.sampleAt(t0 + 10_001), null, 'after the last observation');
  assert.ok(buffer.sampleAt(t0), 'the boundary itself is observed');
  assert.ok(buffer.sampleAt(t0 + 10_000));
});

test('a head exactly on a recorded frame reports OBSERVED, not held', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, { flights: [flight('a', 0, 0)] });
  buffer.append(t0 + 10_000, { flights: [flight('a', 10, 0)] });
  assert.equal(buffer.sampleAt(t0).mode, 'observed');
  assert.equal(buffer.sampleAt(t0 + 10_000).mode, 'observed', 'the newest frame is observed too');
  assert.equal(buffer.sampleAt(t0 + 5_000).mode, 'interpolated');
});

test('sampleAt interpolates between bracketing frames', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, { flights: [flight('a', 0, 0, { heading: 0 })] });
  buffer.append(t0 + 10_000, { flights: [flight('a', 10, 20, { heading: 90 })] });
  const mid = buffer.sampleAt(t0 + 5_000);
  assert.equal(mid.interpolated, true);
  const sample = mid.sources.flights[0];
  assert.ok(Math.abs(sample.lon - 5) < 1e-9);
  assert.ok(Math.abs(sample.lat - 10) < 1e-9);
  assert.ok(Math.abs(sample.heading - 45) < 1e-9);
  assert.equal(sample.interpolated, true);
});

test('REFUSAL: no interpolation across a gap wider than the ceiling', () => {
  const buffer = new TrackBuffer({ maxInterpolationGapMs: 25_000 });
  buffer.append(t0, { flights: [flight('a', 0, 0)] });
  // Six minutes of nothing — the tab slept, or the feed dropped.
  buffer.append(t0 + 360_000, { flights: [flight('a', 60, 0)] });
  const mid = buffer.sampleAt(t0 + 180_000);
  assert.equal(mid.interpolated, false, 'a hole is not glided across');
  assert.equal(mid.mode, 'held', 'and it is reported as a held fix, not an observation');
  assert.equal(mid.sources.flights[0].lon, 0, 'holds the last OBSERVED position');
  assert.equal(mid.gapMs, 360_000, 'and reports the hole it is sitting in');
});

test('an entity absent from the next frame is not extrapolated', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, { flights: [flight('a', 0, 0), flight('b', 5, 5)] });
  buffer.append(t0 + 10_000, { flights: [flight('a', 10, 0)] });
  const mid = buffer.sampleAt(t0 + 5_000);
  const b = mid.sources.flights.find((s) => s.id === 'b');
  assert.equal(b.lon, 5, 'b dropped out — it stays where it was last seen');
  assert.equal(b.interpolated, false);
  const a = mid.sources.flights.find((s) => s.id === 'a');
  assert.equal(a.interpolated, true);
});

test('longitude interpolation takes the short way across the antimeridian', () => {
  assert.ok(Math.abs(lerpLongitude(179, -179, 0.5) - 180) < 1e-9);
  assert.ok(Math.abs(lerpLongitude(-179, 179, 0.5) - -180) < 1e-9);
  assert.ok(Math.abs(lerpLongitude(10, 20, 0.5) - 15) < 1e-9);
});

test('heading interpolation takes the short way across north', () => {
  assert.ok(Math.abs(lerpHeading(350, 10, 0.5) - 0) < 1e-9);
  assert.ok(Math.abs(lerpHeading(10, 350, 0.5) - 0) < 1e-9);
  assert.equal(lerpHeading(null, 90, 0.5), 90);
  assert.equal(lerpHeading(90, null, 0.5), 90);
});

test('eviction drops frames older than the retained window', () => {
  const buffer = new TrackBuffer({ windowMs: 60_000 });
  for (let i = 0; i <= 10; i += 1) {
    buffer.append(t0 + i * 10_000, { flights: [flight('a', i, 0)] });
  }
  const range = buffer.range();
  assert.equal(range.startMs, t0 + 40_000, 'only the last 60 s survives');
  assert.equal(range.endMs, t0 + 100_000);
});

test('the frame ceiling is an independent memory backstop', () => {
  const buffer = new TrackBuffer({ windowMs: 10 * 60 * 60 * 1000, maxFrames: 5 });
  for (let i = 0; i < 50; i += 1) {
    buffer.append(t0 + i * 1000, { flights: [flight('a', 0, 0)] });
  }
  assert.equal(buffer.frameCount, 5);
});

test('per-source records are capped and the truncation is reported, not hidden', () => {
  const buffer = new TrackBuffer({ maxRecordsPerSource: 3 });
  const many = Array.from({ length: 10 }, (_, i) => flight(`a${i}`, i, 0));
  buffer.append(t0, { flights: many });
  assert.equal(buffer.sampleAt(t0).sources.flights.length, 3);
  assert.equal(buffer.coverage()[0].truncated, true);
});

test('coverage is per-source, not the buffer extent', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, { flights: [flight('a', 0, 0)] });
  buffer.append(t0 + 10_000, { flights: [flight('a', 1, 0)] });
  // Vessels came on late — their past is shorter than the buffer's.
  buffer.append(t0 + 20_000, {
    flights: [flight('a', 2, 0)],
    'ais-live-vessels': [{ id: 'ship', mmsi: '1', lon: 4, lat: 51 }],
  });
  const coverage = Object.fromEntries(buffer.coverage().map((c) => [c.sourceId, c]));
  assert.equal(coverage.flights.startMs, t0);
  assert.equal(coverage['ais-live-vessels'].startMs, t0 + 20_000, 'late layer, shorter past');
  assert.equal(coverage['ais-live-vessels'].frames, 1);
});

test('sampleAt can restrict to selected sources', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, {
    flights: [flight('a', 0, 0)],
    earthquakes: [{ id: 'q', lon: 1, lat: 1 }],
  });
  const only = buffer.sampleAt(t0, { sourceIds: ['flights'] });
  assert.deepEqual(Object.keys(only.sources), ['flights']);
});

test('trackOf walks one entity across the buffer', () => {
  const buffer = new TrackBuffer();
  for (let i = 0; i < 5; i += 1) {
    buffer.append(t0 + i * 10_000, { flights: [flight('a', i, 0), flight('b', -i, 0)] });
  }
  const track = buffer.trackOf('flights', 'a');
  assert.equal(track.length, 5);
  assert.deepEqual(track.map((p) => p.lon), [0, 1, 2, 3, 4]);
  const clipped = buffer.trackOf('flights', 'a', t0 + 20_000);
  assert.equal(clipped.length, 3, 'honours the until bound');
});

test('consecutive empty frames collapse instead of filling the buffer', () => {
  const buffer = new TrackBuffer();
  for (let i = 0; i < 20; i += 1) buffer.append(t0 + i * 1000, {});
  assert.equal(buffer.frameCount, 1, 'one frame records the emptiness');
  assert.equal(buffer.range().endMs, t0 + 19_000, 'and it tracks forward in time');
});

test('export carries provenance and per-source coverage, not just points', () => {
  const buffer = new TrackBuffer();
  buffer.append(t0, { flights: [flight('a', 0, 0)] });
  const json = buffer.toJSON({ appVersion: 'test' });
  assert.equal(json.format, 'gods-eye-view/timeline');
  assert.match(json.provenance, /Not an authoritative archive/);
  assert.equal(json.appVersion, 'test');
  assert.equal(json.frames.length, 1);
  assert.equal(json.coverage[0].sourceId, 'flights');
  assert.ok(json.range.startIso.endsWith('Z'));
});

test('an empty buffer has no range and answers no samples', () => {
  const buffer = new TrackBuffer();
  assert.equal(buffer.range(), null);
  assert.equal(buffer.sampleAt(t0), null);
  assert.deepEqual(buffer.coverage(), []);
});

test('the sample budget bounds memory regardless of window or entity count', () => {
  // 100 samples per frame against a 250-sample budget: the window is long
  // enough to keep every frame, so only the budget can be doing the bounding.
  const buffer = new TrackBuffer({ windowMs: 60 * 60 * 1000, maxTotalSamples: 250 });
  const crowd = Array.from({ length: 100 }, (_, i) => flight(`a${i}`, i / 10, 0));
  for (let i = 0; i < 20; i += 1) buffer.append(t0 + i * 1000, { flights: crowd });
  assert.ok(buffer.sampleCount <= 250, `retained ${buffer.sampleCount} samples`);
  assert.equal(buffer.frameCount, 2, 'history shrinks to fit the budget');
  assert.equal(buffer.budgetLimited, true, 'and the buffer admits the window was cut');
});

test('the budget never empties the buffer — one frame always survives', () => {
  const buffer = new TrackBuffer({ maxTotalSamples: 100, maxRecordsPerSource: 5000 });
  const crowd = Array.from({ length: 500 }, (_, i) => flight(`a${i}`, 0, 0));
  buffer.append(t0, { flights: crowd });
  buffer.append(t0 + 1000, { flights: crowd });
  assert.equal(buffer.frameCount, 1, 'over budget on a single frame still records now');
  assert.ok(buffer.sampleAt(t0 + 1000), 'and that frame is readable');
});

test('an unpressured buffer does not claim to be budget limited', () => {
  const buffer = new TrackBuffer({ windowMs: 60_000 });
  for (let i = 0; i <= 10; i += 1) buffer.append(t0 + i * 10_000, { flights: [flight('a', i, 0)] });
  assert.equal(buffer.budgetLimited, false, 'window eviction is not budget eviction');
  assert.equal(buffer.toJSON().budgetLimited, false);
});
