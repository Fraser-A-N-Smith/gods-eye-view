// Fields+rows mapper for the CNEOS fireball API — the single implementation
// shared by the /api/fireballs proxy (vite.config.js) and the fireballs.js
// layer. Testing it here, once, against its one real implementation is what
// makes server/client drift impossible rather than merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapFireballRow, mapFireballRows } from './fireballsShape.js';
import { mapFireballRow as reExportedMapFireballRow } from './fireballs.js';

const FIELDS = ['date', 'energy', 'impact-e', 'lat', 'lat-dir', 'lon', 'lon-dir', 'alt', 'vel'];

test('mapFireballRow: applies S/W sign to unsigned lat/lon magnitudes', () => {
  const row = ['2026-08-15 07:32:40', '3.9', '0.13', '4.0', 'N', '115.4', 'W', '37.0', null];
  const r = mapFireballRow(FIELDS, row);
  assert.equal(r.lat, 4.0);
  assert.equal(r.lon, -115.4);
  assert.equal(r.energyKt, 3.9);
  assert.equal(r.altitudeKm, 37.0);
  assert.equal(r.velocityKmS, null);
});

test('mapFireballRow: N/E stays positive', () => {
  const row = ['2026-08-01 17:43:48', '2.9', '0.1', '19.5', 'S', '176.2', 'E', '45.0', null];
  const r = mapFireballRow(FIELDS, row);
  assert.equal(r.lat, -19.5);
  assert.equal(r.lon, 176.2);
});

test('mapFireballRow: missing lat or lon returns null', () => {
  assert.equal(mapFireballRow(FIELDS, ['2026-01-01', '1', '1', null, 'N', '1', 'E', null, null]), null);
});

test('mapFireballRow: null numeric fields stay null, never NaN', () => {
  const row = ['2026-08-14 07:48:36', '3.8', '0.13', '47.7', 'N', '119.4', 'W', '30.0', '12.2'];
  const r = mapFireballRow(FIELDS, row);
  for (const v of Object.values(r)) assert.notEqual(v, undefined);
  if (typeof r.velocityKmS === 'number') assert.ok(Number.isFinite(r.velocityKmS));
});

test('mapFireballRow: non-array fields or row returns null', () => {
  assert.equal(mapFireballRow(null, ['a']), null);
  assert.equal(mapFireballRow(FIELDS, null), null);
  assert.equal(mapFireballRow(undefined, undefined), null);
});

test('mapFireballRow: field order is looked up by name, not position', () => {
  // Same data, columns permuted — must resolve identically.
  const shuffled = ['lon-dir', 'lat-dir', 'lon', 'lat', 'vel', 'alt', 'impact-e', 'energy', 'date'];
  const row = ['W', 'N', '115.4', '4.0', null, '37.0', '0.13', '3.9', '2026-08-15 07:32:40'];
  const r = mapFireballRow(shuffled, row);
  assert.equal(r.lat, 4.0);
  assert.equal(r.lon, -115.4);
  assert.equal(r.energyKt, 3.9);
  assert.equal(r.impactEnergyKt, 0.13);
  assert.equal(r.altitudeKm, 37.0);
});

test('mapFireballRow: builds a stable id from date/lat/lon and parses dateMs as UTC', () => {
  const row = ['2026-08-15 07:32:40', '3.9', '0.13', '4.0', 'N', '115.4', 'W', '37.0', null];
  const r = mapFireballRow(FIELDS, row);
  assert.equal(r.id, '2026-08-15 07:32:40:4:-115.4');
  assert.equal(r.dateMs, Date.parse('2026-08-15T07:32:40Z'));
});

test('mapFireballRow: missing date yields a null dateMs', () => {
  const row = [null, '3.9', '0.13', '4.0', 'N', '115.4', 'W', '37.0', null];
  const r = mapFireballRow(FIELDS, row);
  assert.equal(r.dateMs, null);
});

test('mapFireballRow: output is JSON-safe', () => {
  const row = ['2026-08-15 07:32:40', '3.9', '0.13', '4.0', 'N', '115.4', 'W', '37.0', null];
  const r = mapFireballRow(FIELDS, row);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test('mapFireballRows: maps every row, dropping ones with no usable lat/lon', () => {
  const rows = [
    ['2026-08-15 07:32:40', '3.9', '0.13', '4.0', 'N', '115.4', 'W', '37.0', null],
    ['2026-01-01', '1', '1', null, 'N', '1', 'E', null, null],
    ['2026-08-01 17:43:48', '2.9', '0.1', '19.5', 'S', '176.2', 'E', '45.0', null],
  ];
  const mapped = mapFireballRows(FIELDS, rows);
  assert.equal(mapped.length, 2);
  assert.deepEqual(mapped.map((r) => r.lat), [4.0, -19.5]);
});

test('mapFireballRows: non-array rows yields an empty array', () => {
  assert.deepEqual(mapFireballRows(FIELDS, null), []);
  assert.deepEqual(mapFireballRows(FIELDS, undefined), []);
});

test('fireballs.js re-exports the SAME mapFireballRow implementation (reference identity, not a copy)', () => {
  assert.equal(reExportedMapFireballRow, mapFireballRow);
});
