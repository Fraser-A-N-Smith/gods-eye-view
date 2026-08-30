import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOverpassElement } from './criticalInfrastructure.js';
import * as CriticalInfrastructureShape from './criticalInfrastructureShape.js';
import criticalInfrastructureLayer, {
  mapAnalystRecord,
  responseSaturated,
  withinViewport,
} from './criticalInfrastructure.js';
import {
  _resetRenderGovernorForTest,
  getRenderGovernorDiagnostics,
  installRenderGovernor,
} from '../renderGovernor.js';
import * as Cesium from 'cesium';

test('mapOverpassElement: node with power=plant tag maps to a power-plant record', () => {
  const el = { type: 'node', id: 1, lat: 51.5, lon: -0.1, tags: { power: 'plant', name: 'Battersea' } };
  assert.deepEqual(mapOverpassElement(el), { id: 'node/1', kind: 'power-plant', name: 'Battersea', lat: 51.5, lon: -0.1 });
});

test('mapOverpassElement: way with amenity=hospital uses the center point', () => {
  const el = { type: 'way', id: 2, center: { lat: 40.7, lon: -74.0 }, tags: { amenity: 'hospital', name: 'City General' } };
  assert.deepEqual(mapOverpassElement(el), { id: 'way/2', kind: 'hospital', name: 'City General', lat: 40.7, lon: -74.0 });
});

test('mapOverpassElement: missing name falls back to a generic label per kind', () => {
  assert.equal(mapOverpassElement({ type: 'node', id: 3, lat: 0, lon: 0, tags: { power: 'plant' } }).name, 'Unnamed power plant');
  assert.equal(mapOverpassElement({ type: 'node', id: 4, lat: 0, lon: 0, tags: { amenity: 'hospital' } }).name, 'Unnamed hospital');
});

test('mapOverpassElement: element with neither direct nor center coordinates returns null', () => {
  assert.equal(mapOverpassElement({ type: 'way', id: 5, tags: { power: 'plant' } }), null);
});

test('mapOverpassElement: element with neither tag matches returns null', () => {
  assert.equal(mapOverpassElement({ type: 'node', id: 6, lat: 0, lon: 0, tags: { shop: 'bakery' } }), null);
});

// The contract above pins the same test vectors task-5-brief.md specifies for
// criticalInfrastructure.js; the identity test below (not merely re-running
// the same assertions) proves this module holds no separate implementation
// to drift out of sync with the one criticalInfrastructureShape.test.mjs
// exercises in full.
test('criticalInfrastructure.js re-exports the SAME mapOverpassElement function criticalInfrastructureShape.js implements', () => {
  assert.equal(mapOverpassElement, CriticalInfrastructureShape.mapOverpassElement);
});

test('responseSaturated: derives truncation from the element count when the flag is absent', () => {
  const atCap = { elements: new Array(300).fill({}), elementCap: 300 };
  assert.equal(responseSaturated(atCap), true, 'derived from the reported cap');
  assert.equal(
    responseSaturated({ elements: new Array(299).fill({}), elementCap: 300 }),
    false,
  );
  // An explicit flag always wins over the derivation.
  assert.equal(responseSaturated({ ...atCap, saturated: false }), false);
  assert.equal(responseSaturated({ elements: [], saturated: true }), true);
  // Nothing to derive from: do not invent saturation.
  assert.equal(responseSaturated({ elements: new Array(300).fill({}) }), false);
  assert.equal(responseSaturated(null), false);
});

test('withinViewport: keeps points inside the requested box and drops the snap ring', () => {
  const box = { south: 30, west: -98, north: 31, east: -97 };
  assert.equal(withinViewport({ lat: 30.5, lon: -97.5 }, box), true);
  assert.equal(withinViewport({ lat: 30.5, lon: -96.5 }, box), false, 'a point from the snapped superset must be cut');
  assert.equal(withinViewport(null, box), false);
  assert.equal(withinViewport({ lat: 30.5, lon: -97.5 }, null), false);
  assert.equal(withinViewport({ lat: 'oops', lon: -97.5 }, box), false);
});

test('mapAnalystRecord: maps every contract field and falls back id/kind/name to null', () => {
  assert.deepEqual(
    mapAnalystRecord({ id: 'node/1', kind: 'power-plant', name: 'Battersea', lat: 51.5, lon: -0.1 }),
    { id: 'node/1', kind: 'power-plant', name: 'Battersea', lat: 51.5, lon: -0.1 },
  );
  const fallback = mapAnalystRecord({}, 3);
  assert.equal(fallback.id, 'CRITICAL-INFRA-0003');
  assert.equal(fallback.kind, null);
  assert.equal(fallback.name, null);
  assert.equal(fallback.lat, null);
  assert.equal(fallback.lon, null);
});

const VIEWPORT = { south: 30, west: -98, north: 31, east: -97 };

/**
 * Drive one real `update()` of the layer against a stubbed proxy, and expose
 * what actually reached the map.
 */
async function runInfrastructureLoad({
  elements = [],
  saturated = false,
  exactElements = null,
  exactSaturated = false,
  failWith = null,
}) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  _resetRenderGovernorForTest();
  globalThis.fetch = async (url) => {
    const href = String(url);
    requests.push(href);
    if (failWith) {
      return { ok: false, status: 503, json: async () => ({ error: failWith }) };
    }
    const exact = href.includes('exact=1');
    const payload = {
      status: 'fresh',
      retrievedAt: '2026-08-30T00:00:00.000Z',
      elements: exact && exactElements ? exactElements : elements,
      elementCap: 300,
      saturated: exact ? exactSaturated : saturated,
    };
    return { ok: true, status: 200, json: async () => payload };
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

  criticalInfrastructureLayer.init(viewer);
  installRenderGovernor(viewer);
  criticalInfrastructureLayer.enable();
  await criticalInfrastructureLayer.update();

  return {
    requests,
    viewer,
    fireMoveEnd() { for (const listener of moveEndListeners) listener(); },
    entities: () => dataSources[0]?.entities?.values || [],
    stats: () => criticalInfrastructureLayer.getStats(),
    analystRecords: (max) => criticalInfrastructureLayer.getAnalystRecords(max),
    renderRequests: () => getRenderGovernorDiagnostics().recentRequests.map((item) => item.reason),
    restore() {
      criticalInfrastructureLayer.destroy(viewer);
      _resetRenderGovernorForTest();
      globalThis.fetch = originalFetch;
    },
  };
}

test('off-viewport records from the snapped superset never render', async () => {
  const harness = await runInfrastructureLoad({
    elements: [
      { id: 'node/1', kind: 'power-plant', name: 'In View', lat: 30.5, lon: -97.5 },
      { id: 'node/2', kind: 'hospital', name: 'Off View', lat: 30.5, lon: -96.2 },
    ],
  });
  try {
    const now = Cesium.JulianDate.now();
    const names = harness.entities().map((entity) => entity.properties?.name?.getValue(now));
    assert.deepEqual(names, ['In View'], 'only the in-viewport site renders');
    assert.equal(harness.stats().count, 1);
  } finally {
    harness.restore();
  }
});

test('a saturated snapped tile refetches the exact viewport before rendering', async () => {
  const elements = [];
  for (let index = 0; index < 300; index += 1) {
    // A saturated snapped response full of OFF-viewport sites: the in-view
    // ones were crowded out upstream.
    elements.push({ id: `node/${1000 + index}`, kind: 'hospital', name: 'Off view', lat: 30.5, lon: -96.2 });
  }
  const harness = await runInfrastructureLoad({
    elements,
    saturated: true,
    exactElements: [
      { id: 'node/7', kind: 'power-plant', name: 'Rescued', lat: 30.5, lon: -97.5 },
    ],
  });
  try {
    assert.equal(harness.requests.length, 2, 'saturation triggers exactly one retry');
    assert.equal(harness.requests[0].includes('exact=1'), false, 'first ask uses the shared snapped tile');
    assert.equal(harness.requests[1].includes('exact=1'), true, 'retry opts out of the snap');
    const now = Cesium.JulianDate.now();
    const names = harness.entities().map((entity) => entity.properties?.name?.getValue(now));
    assert.deepEqual(names, ['Rescued'], 'the in-viewport site is no longer starved by off-view ones');
  } finally {
    harness.restore();
  }
});

test('an unsaturated response never pays for a second upstream ask', async () => {
  const harness = await runInfrastructureLoad({
    elements: [{ id: 'node/3', kind: 'power-plant', name: 'Plant', lat: 30.5, lon: -97.5 }],
  });
  try {
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.stats().saturated, false);
  } finally {
    harness.restore();
  }
});

test('a still-saturated exact viewport is reported honestly instead of implied complete', async () => {
  const elements = [];
  for (let index = 0; index < 300; index += 1) {
    elements.push({ id: `node/${2000 + index}`, kind: 'power-plant', name: 'P', lat: 30.5, lon: -97.5 });
  }
  const harness = await runInfrastructureLoad({ elements, saturated: true, exactSaturated: true });
  try {
    assert.equal(harness.stats().saturated, true);
    assert.match(harness.stats().error, /Too many facilities/);
  } finally {
    harness.restore();
  }
});

test('a camera move refetches the viewport, debounced and abortable', async () => {
  const harness = await runInfrastructureLoad({
    elements: [{ id: 'node/1', kind: 'power-plant', name: 'Plant', lat: 30.5, lon: -97.5 }],
  });
  try {
    assert.equal(harness.requests.length, 1, 'the initial enable-triggered update fetched once');
    harness.fireMoveEnd();
    // The debounce timer needs to elapse before a second request fires.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(harness.requests.length, 2, 'moveEnd schedules a debounced refetch');
  } finally {
    harness.restore();
  }
});

test('a failed load buys the frame its status change needs', async () => {
  const harness = await runInfrastructureLoad({ failWith: 'Critical infrastructure HTTP 503' });
  try {
    assert.equal(harness.stats().status, 'unavailable');
    assert.ok(
      harness.renderRequests().some((reason) => reason === 'critical-infrastructure-status'),
      'an idle governor would otherwise leave the last healthy readout on screen',
    );
  } finally {
    harness.restore();
  }
});

test('zoom-out (no bounded viewport) reports zoom-in guidance without fetching', async () => {
  const harness = await runInfrastructureLoad({
    elements: [{ id: 'node/1', kind: 'power-plant', name: 'Plant', lat: 30.5, lon: -97.5 }],
  });
  try {
    // Force a global/unbounded view.
    harness.viewer.camera.computeViewRectangle = () => null;
    await criticalInfrastructureLayer.update();
    assert.equal(harness.requests.length, 1, 'no additional fetch was made for the unbounded view');
    assert.equal(harness.stats().status, 'zoom-in');
  } finally {
    harness.restore();
  }
});

test('disabling aborts an in-flight request and hides the data source', async () => {
  const originalFetch = globalThis.fetch;
  let observedSignal;
  globalThis.fetch = async (_url, options = {}) => {
    observedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const dataSources = [];
  const viewer = {
    camera: {
      moveEnd: { addEventListener() { return () => {}; } },
      computeViewRectangle() {
        return {
          south: Cesium.Math.toRadians(VIEWPORT.south),
          west: Cesium.Math.toRadians(VIEWPORT.west),
          north: Cesium.Math.toRadians(VIEWPORT.north),
          east: Cesium.Math.toRadians(VIEWPORT.east),
        };
      },
    },
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  try {
    criticalInfrastructureLayer.init(viewer);
    criticalInfrastructureLayer.enable();
    const pending = criticalInfrastructureLayer.update();
    assert.equal(criticalInfrastructureLayer.getStats().loading, true);
    criticalInfrastructureLayer.disable();
    await pending;
    assert.equal(observedSignal.aborted, true);
    assert.equal(criticalInfrastructureLayer.getStats().loading, false);
    assert.equal(dataSources[0].show, false);
  } finally {
    criticalInfrastructureLayer.destroy(viewer);
    globalThis.fetch = originalFetch;
  }
});
