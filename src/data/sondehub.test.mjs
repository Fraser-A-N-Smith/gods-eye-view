// src/data/sondehub.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine
// seam) plus lifecycle coverage with a mocked fetch, mirroring the ocean
// buoys/volcanoes layer test style. The telemetry-normalization contract
// itself is covered once, against its one real implementation, in
// sondehubShape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createSondehubLayer, mapAnalystRecord } from './sondehub.js';

const FULL_RAW = {
  id: 'S4130123',
  lat: 38.5,
  lon: -121.7,
  altitudeM: 18500.4,
  verticalSpeedMs: 5.2,
  horizontalSpeedMs: 12.1,
  headingDeg: 270,
  tempC: -45.2,
  launchSite: 'Oakland, CA',
};

test('sonde analyst record: full record maps every contract field', () => {
  assert.deepEqual(mapAnalystRecord(FULL_RAW, 3), FULL_RAW);
});

test('sonde analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'SONDE-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'SONDE-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'SONDE-0000');
});

test('sonde analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'S1', altitudeM: NaN, verticalSpeedMs: undefined }, 0);
  assert.equal(r.altitudeM, null);
  assert.equal(r.verticalSpeedMs, null);
  assert.equal(r.headingDeg, null);
  assert.equal(r.tempC, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('sonde analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
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

function sondePayload(overrides) {
  return {
    sondes: [
      { id: 'sonde-1', lat: 38.5, lon: -121.7, altitudeM: 5000 },
      { id: 'sonde-2', lat: 40.1, lon: -74.0, altitudeM: 18000 },
      { id: 'sonde-3', lat: 51.5, lon: -0.1, altitudeM: 27000 },
      ...(overrides || []),
    ],
  };
}

test('sonde altitude color bands: ascent is cyan, cruise is yellow, near-burst is orange', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createSondehubLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => sondePayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    assert.equal(entities.length, 3);
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();

    assert.ok(byId['sonde:sonde-1'].point.color.getValue(now).equals(Cesium.Color.CYAN));
    assert.ok(byId['sonde:sonde-2'].point.color.getValue(now).equals(Cesium.Color.YELLOW));
    assert.ok(byId['sonde:sonde-3'].point.color.getValue(now).equals(Cesium.Color.ORANGE));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('real sondehub lifecycle: init/enable/update/disable/destroy', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createSondehubLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => sondePayload() });
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
    assert.ok(entity.point, 'sondes render as points');
    assert.ok(entity.label, 'sondes carry an altitude label');

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.id).sort(), ['sonde-1', 'sonde-2', 'sonde-3']);

    layer.disable(viewer);
    assert.equal(viewer._dataSources[0].show, false);
    assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layer reports no records');

    layer.destroy(viewer);
    assert.equal(viewer._dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sondehub refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createSondehubLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Sondehub HTTP 503');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ sondes: [] }) });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('sondehub refresh rejects a malformed payload without throwing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createSondehubLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notSondes: [] }) });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Malformed sondehub response');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
