// src/data/fireballs.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine
// seam) plus lifecycle coverage with a mocked fetch, mirroring the
// ocean-buoys/border-wait-times layer test style. The fields+rows mapping
// contract itself is covered once, against its one real implementation, in
// fireballsShape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import * as FireballsShape from './fireballsShape.js';
import {
  createFireballsLayer,
  mapAnalystRecord,
  mapFireballRow,
  mapFireballRows,
} from './fireballs.js';

const FULL_RAW = {
  id: '2026-08-15 07:32:40:4:-115.4',
  dateMs: 1786858360000,
  energyKt: 3.9,
  impactEnergyKt: 0.13,
  lat: 4.0,
  lon: -115.4,
  altitudeKm: 37.0,
  velocityKmS: 12.2,
};

test('fireball analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, {
    id: '2026-08-15 07:32:40:4:-115.4',
    dateMs: 1786858360000,
    energyKt: 3.9,
    impactEnergyKt: 0.13,
    lat: 4.0,
    lon: -115.4,
    altitudeKm: 37.0,
    velocityKmS: 12.2,
  });
});

test('fireball analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'FIREBALL-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'FIREBALL-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'FIREBALL-0000');
});

test('fireball analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'x', altitudeKm: NaN, velocityKmS: undefined }, 0);
  assert.equal(r.altitudeKm, null);
  assert.equal(r.velocityKmS, null);
  assert.equal(r.energyKt, null);
  assert.equal(r.impactEnergyKt, null);
  assert.equal(r.lat, null);
  assert.equal(r.lon, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('fireball analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── Re-export wiring ────────────────────────────────────────────────────────
// Not a re-test of the mapping contract (that lives once in
// fireballsShape.test.mjs) — just confirms fireballs.js's exported
// mapFireballRow/mapFireballRows really are the shared implementation by
// reference, not a second copy that happens to look similar.

test('fireballs.js re-exports the SAME mapFireballRow/mapFireballRows functions fireballsShape.js implements', () => {
  assert.equal(mapFireballRow, FireballsShape.mapFireballRow);
  assert.equal(mapFireballRows, FireballsShape.mapFireballRows);
});

function makeViewer() {
  const dataSources = [];
  return {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
    _dataSources: dataSources,
  };
}

function fireballPayload(overrides) {
  return {
    fireballs: [
      { id: 'fb-1', dateMs: 1, lat: 10, lon: 20, energyKt: 5, impactEnergyKt: 0.2, altitudeKm: 30, velocityKmS: 15 },
      { id: 'fb-2', dateMs: 2, lat: -11, lon: -21, energyKt: 0.5, impactEnergyKt: 0.02, altitudeKm: null, velocityKmS: null },
      { id: 'fb-3', dateMs: 3, lat: 12, lon: 22, energyKt: null, impactEnergyKt: null, altitudeKm: null, velocityKmS: null },
      ...(overrides || []),
    ],
  };
}

test('real fireballs lifecycle: init/enable/update/disable/destroy', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createFireballsLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => fireballPayload() });
  try {
    layer.init(viewer);
    assert.equal(viewer._dataSources[0].show, false, 'starts hidden');
    layer.enable(viewer);
    assert.equal(viewer._dataSources[0].show, true);

    await layer.update(viewer);
    assert.equal(layer.getStats().count, 3);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
    assert.equal(layer.getStats().error, null);

    const [entity] = viewer._dataSources[0].entities.values;
    assert.ok(entity.point, 'fireballs render as points');
    assert.ok(entity.label, 'fireballs carry an energy label');

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.id).sort(), ['fb-1', 'fb-2', 'fb-3']);

    layer.disable(viewer);
    assert.equal(viewer._dataSources[0].show, false);
    assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layer reports no records');

    layer.destroy(viewer);
    assert.equal(viewer._dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fireball with no energy reading still renders (falls back to a minimum radius, never NaN)', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createFireballsLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => fireballPayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();
    const pixelSize = byId['fireball:fb-3'].point.pixelSize.getValue(now);
    assert.ok(Number.isFinite(pixelSize), 'pixelSize must never be NaN when energyKt is null');
    assert.ok(pixelSize > 0);
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('fireballs refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createFireballsLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Fireballs HTTP 503');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ fireballs: [] }) });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('fireballs refresh rejects a malformed payload without throwing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createFireballsLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notFireballs: [] }) });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Malformed fireballs response');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
