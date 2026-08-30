// src/data/oceanBuoys.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine
// seam) plus lifecycle coverage with a mocked fetch, mirroring the
// volcanoes/earthquakes layer test style. The fixed-width parser contract
// itself is covered once, against its one real implementation, in
// oceanBuoysShape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import * as OceanBuoysShape from './oceanBuoysShape.js';
import {
  createOceanBuoysLayer,
  mapAnalystRecord,
  parseNdbcLine,
  parseNdbcText,
} from './oceanBuoys.js';

const FULL_RAW = {
  id: '22101',
  lat: 37.24,
  lon: 126.02,
  windSpeedMs: 1.0,
  waveHeightM: 0.0,
  airTempC: 25.0,
  waterTempC: 26.2,
};

test('buoy analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, {
    id: '22101',
    lat: 37.24,
    lon: 126.02,
    windSpeedMs: 1.0,
    waveHeightM: 0.0,
    airTempC: 25.0,
    waterTempC: 26.2,
  });
});

test('buoy analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'BUOY-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'BUOY-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'BUOY-0000');
});

test('buoy analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: '99999', waveHeightM: NaN, windSpeedMs: undefined }, 0);
  assert.equal(r.waveHeightM, null);
  assert.equal(r.windSpeedMs, null);
  assert.equal(r.airTempC, null);
  assert.equal(r.waterTempC, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('buoy analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── Re-export wiring ────────────────────────────────────────────────────────
// Not a re-test of the parser contract (that lives once in
// oceanBuoysShape.test.mjs) — just confirms oceanBuoys.js's exported
// parseNdbcLine/parseNdbcText really are the shared implementation by
// reference, not a second copy that happens to look similar.

test('oceanBuoys.js re-exports the SAME parseNdbcLine/parseNdbcText functions oceanBuoysShape.js implements', () => {
  assert.equal(parseNdbcLine, OceanBuoysShape.parseNdbcLine);
  assert.equal(parseNdbcText, OceanBuoysShape.parseNdbcText);
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

function buoyPayload(overrides) {
  return {
    buoys: [
      { id: 'buoy-1', lat: 10, lon: 20, windSpeedMs: 5, waveHeightM: 5.5, airTempC: 20, waterTempC: 19 },
      { id: 'buoy-2', lat: 11, lon: 21, windSpeedMs: 3, waveHeightM: 1.5, airTempC: 18, waterTempC: 17 },
      { id: 'buoy-3', lat: 12, lon: 22, windSpeedMs: 2, waveHeightM: null, airTempC: null, waterTempC: null },
      ...(overrides || []),
    ],
  };
}

test('buoy wave-height color bands: high wave is red, moderate is yellow, no reading is gray', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createOceanBuoysLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => buoyPayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    assert.equal(entities.length, 3);
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();

    assert.ok(byId['buoy:buoy-1'].point.color.getValue(now).equals(Cesium.Color.RED));
    assert.ok(byId['buoy:buoy-2'].point.color.getValue(now).equals(Cesium.Color.YELLOW));
    assert.ok(byId['buoy:buoy-3'].point.color.getValue(now).equals(Cesium.Color.GRAY),
      'a buoy with no wave-height reading must render gray, not calm-colored');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('real ocean buoys lifecycle: init/enable/update/disable/destroy', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createOceanBuoysLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => buoyPayload() });
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
    assert.ok(entity.point, 'buoys render as points');
    assert.ok(entity.label, 'buoys carry a wind-speed label');

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.id).sort(), ['buoy-1', 'buoy-2', 'buoy-3']);

    layer.disable(viewer);
    assert.equal(viewer._dataSources[0].show, false);
    assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layer reports no records');

    layer.destroy(viewer);
    assert.equal(viewer._dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ocean buoys refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createOceanBuoysLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Ocean Buoys HTTP 503');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ buoys: [] }) });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('ocean buoys refresh rejects a malformed payload without throwing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createOceanBuoysLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notBuoys: [] }) });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Malformed ocean buoys response');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
