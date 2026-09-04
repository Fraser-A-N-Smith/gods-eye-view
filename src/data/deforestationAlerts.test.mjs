// src/data/deforestationAlerts.test.mjs
// Focused tests for the pure analyst-record mapper and viewport filter, plus
// lifecycle coverage with a mocked fetch, mirroring the criticalInfrastructure
// layer test style. The GFW row-normalization contract itself is covered
// once, against its one real implementation, in deforestationAlertsShape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  _resetRenderGovernorForTest,
  installRenderGovernor,
} from '../renderGovernor.js';
import deforestationAlertsLayer, { mapAnalystRecord, withinViewport } from './deforestationAlerts.js';

test('withinViewport: keeps points inside the requested box and drops the snap ring', () => {
  const box = { south: -3.5, west: -60.5, north: -2.5, east: -59.5 };
  assert.equal(withinViewport({ lat: -3.1, lon: -60.2 }, box), true);
  assert.equal(withinViewport({ lat: -3.1, lon: -58.0 }, box), false, 'a point from the snapped superset must be cut');
  assert.equal(withinViewport(null, box), false);
  assert.equal(withinViewport({ lat: -3.1, lon: -60.2 }, null), false);
  assert.equal(withinViewport({ lat: 'oops', lon: -60.2 }, box), false);
});

test('mapAnalystRecord: full record maps every contract field', () => {
  const raw = { id: 'gfw:1', lat: -3.1, lon: -60.2, alertDate: '2026-08-20T00:00:00.000Z', confidence: 'high' };
  assert.deepEqual(mapAnalystRecord(raw, 3), raw);
});

test('mapAnalystRecord: missing id falls back to index-based id; missing fields become null', () => {
  assert.equal(mapAnalystRecord({}, 3).id, 'DEFOREST-0003');
  const r = mapAnalystRecord({ id: 'x', lat: NaN, alertDate: undefined }, 0);
  assert.equal(r.lat, null);
  assert.equal(r.alertDate, null);
  for (const value of Object.values(r)) assert.notEqual(value, undefined);
});

const VIEWPORT = { south: -3.5, west: -60.5, north: -2.5, east: -59.5 };

async function runDeforestationLoad({ alerts = [], truncated = false, failWith = null, noKey = false }) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  _resetRenderGovernorForTest();
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (noKey) return { ok: false, status: 503, json: async () => ({ error: 'no_key' }) };
    if (failWith) return { ok: false, status: 503, json: async () => ({ error: failWith }) };
    return { ok: true, status: 200, json: async () => ({ alerts, truncated, retrievedAt: Date.now() }) };
  };
  const dataSources = [];
  const moveEndListeners = new Set();
  const viewer = {
    camera: {
      moveEnd: {
        addEventListener(listener) {
          moveEndListeners.add(listener);
          return () => moveEndListeners.delete(listener);
        },
      },
      computeViewRectangle() {
        return {
          south: Cesium.Math.toRadians(VIEWPORT.south),
          west: Cesium.Math.toRadians(VIEWPORT.west),
          north: Cesium.Math.toRadians(VIEWPORT.north),
          east: Cesium.Math.toRadians(VIEWPORT.east),
        };
      },
    },
    scene: {
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      requestRenderMode: false,
      maximumRenderTimeChange: 0,
      requestRender() {},
    },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };

  deforestationAlertsLayer.init(viewer);
  installRenderGovernor(viewer);
  deforestationAlertsLayer.enable();
  await deforestationAlertsLayer.update();

  return {
    requests,
    fireMoveEnd() { for (const listener of moveEndListeners) listener(); },
    entities: () => dataSources[0]?.entities?.values || [],
    stats: () => deforestationAlertsLayer.getStats(),
    analystRecords: (max) => deforestationAlertsLayer.getAnalystRecords(max),
    restore() {
      deforestationAlertsLayer.destroy(viewer);
      _resetRenderGovernorForTest();
      globalThis.fetch = originalFetch;
    },
  };
}

test('off-viewport alerts from the snapped superset never render', async () => {
  const harness = await runDeforestationLoad({
    alerts: [
      { id: 'in-view', lat: -3.1, lon: -60.2, alertDate: '2026-08-20T00:00:00.000Z' },
      { id: 'off-view', lat: -3.1, lon: -58.0, alertDate: '2026-08-20T00:00:00.000Z' },
    ],
  });
  try {
    assert.equal(harness.stats().count, 1);
    assert.equal(harness.entities().length, 1);
  } finally {
    harness.restore();
  }
});

test('recency color bands: recent is red, old is gray', async () => {
  const harness = await runDeforestationLoad({
    alerts: [
      { id: 'recent', lat: -3.1, lon: -60.2, alertDate: new Date().toISOString() },
      { id: 'old', lat: -3.2, lon: -60.3, alertDate: '2020-01-01T00:00:00.000Z' },
    ],
  });
  try {
    const now = Cesium.JulianDate.now();
    const byId = Object.fromEntries(harness.entities().map((e) => [e.id, e]));
    assert.ok(byId['deforestation-alert:recent'].point.color.getValue(now).equals(Cesium.Color.RED));
    assert.ok(byId['deforestation-alert:old'].point.color.getValue(now).equals(Cesium.Color.GRAY));
  } finally {
    harness.restore();
  }
});

test('missing GFW_API_TOKEN reports KEY REQUIRED rather than an error', async () => {
  const harness = await runDeforestationLoad({ noKey: true });
  try {
    assert.equal(harness.stats().status, 'key-required');
    assert.equal(harness.stats().count, 0);
  } finally {
    harness.restore();
  }
});

test('a camera move refetches the viewport, debounced', async () => {
  const harness = await runDeforestationLoad({ alerts: [{ id: 'a', lat: -3.1, lon: -60.2 }] });
  try {
    assert.equal(harness.requests.length, 1);
    harness.fireMoveEnd();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(harness.requests.length, 2);
  } finally {
    harness.restore();
  }
});

test('a failed load is reported and the layer recovers on the next success', async () => {
  const harness = await runDeforestationLoad({ failWith: 'boom' });
  try {
    assert.equal(harness.stats().status, 'unavailable');
    assert.equal(harness.stats().count, 0);
    assert.deepEqual(harness.analystRecords(), []);
  } finally {
    harness.restore();
  }
});

test('getAnalystRecords returns [] while the layer is disabled', async () => {
  const harness = await runDeforestationLoad({ alerts: [{ id: 'a', lat: -3.1, lon: -60.2 }] });
  try {
    assert.ok(harness.analystRecords().length > 0);
    deforestationAlertsLayer.disable();
    assert.deepEqual(harness.analystRecords(), []);
  } finally {
    harness.restore();
  }
});
