// SondeHub telemetry normalizer — the single implementation shared by the
// /api/sondehub proxy (vite.config.js) and the sondehub.js layer. Testing it
// here, once, against its one real implementation is what makes server/client
// drift impossible rather than merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSondeTelemetry, mapSondeTelemetryFeed } from './sondehubShape.js';

test('mapSondeTelemetry: maps a well-formed telemetry point', () => {
  const record = mapSondeTelemetry('S4130123', {
    lat: 38.5, lon: -121.7, alt: 18500.4, vel_v: 5.2, vel_h: 12.1,
    heading: 270, temp: -45.2, launch_site: 'Oakland, CA', datetime: '2026-08-31T12:00:00Z',
  });
  assert.deepEqual(record, {
    id: 'S4130123', lat: 38.5, lon: -121.7, altitudeM: 18500.4,
    verticalSpeedMs: 5.2, horizontalSpeedMs: 12.1, headingDeg: 270,
    tempC: -45.2, launchSite: 'Oakland, CA', observedAt: '2026-08-31T12:00:00.000Z',
  });
});

test('mapSondeTelemetry: missing coordinates or altitude reject the entry', () => {
  assert.equal(mapSondeTelemetry('S1', { lat: null, lon: -121.7, alt: 100 }), null);
  assert.equal(mapSondeTelemetry('S1', { lat: 38.5, lon: -121.7, alt: null }), null);
  assert.equal(mapSondeTelemetry('S1', {}), null);
  assert.equal(mapSondeTelemetry('S1', null), null);
});

test('mapSondeTelemetry: an invalid/missing timestamp yields observedAt: null, not a crash', () => {
  const record = mapSondeTelemetry('S1', { lat: 38.5, lon: -121.7, alt: 100, datetime: 'not-a-time' });
  assert.equal(record.observedAt, null);
  const noTime = mapSondeTelemetry('S1', { lat: 38.5, lon: -121.7, alt: 100 });
  assert.equal(noTime.observedAt, null);
});

test('mapSondeTelemetry: output is JSON-safe', () => {
  const record = mapSondeTelemetry('S1', { lat: 38.5, lon: -121.7, alt: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

test('mapSondeTelemetryFeed: maps every entry in the keyed object, drops unusable ones', () => {
  const feed = mapSondeTelemetryFeed({
    S1: { lat: 38.5, lon: -121.7, alt: 100 },
    S2: { lat: null, lon: -121.7, alt: 100 },
    S3: { lat: 40.1, lon: -74.0, alt: 20500 },
  });
  assert.equal(feed.length, 2);
  assert.deepEqual(feed.map((r) => r.id), ['S1', 'S3']);
});

test('mapSondeTelemetryFeed: caps at maxCount and rejects non-object payloads', () => {
  const many = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`S${i}`, { lat: 38.5, lon: -121.7, alt: 100 }]),
  );
  assert.equal(mapSondeTelemetryFeed(many, 3).length, 3);
  assert.deepEqual(mapSondeTelemetryFeed(null), []);
  assert.deepEqual(mapSondeTelemetryFeed('not an object'), []);
  assert.deepEqual(mapSondeTelemetryFeed([]), []);
});
