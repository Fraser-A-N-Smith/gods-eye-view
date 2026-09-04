// src/data/earthquakes.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine seam).
// Pure function — no viewer/DOM needed; imported directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Cesium from 'cesium';
import {
  EARTHQUAKE_OVERLAY_COHORT_LIMIT,
  EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
  createEarthquakeOverlayEntry,
  createEarthquakesLayer,
  isDuplicateEmscEvent,
  mapAnalystRecord,
  mapEmscFeature,
  selectEarthquakeOverlayCohort,
} from './earthquakes.js';
import { DataLayerManager } from './manager.js';
import {
  getRenderGovernorDiagnostics,
  installRenderGovernor,
  _resetRenderGovernorForTest,
} from '../renderGovernor.js';

const FULL_RAW = {
  id: 'us7000abcd',
  mag: 5.2,
  place: '42 km SW of Anchorage, Alaska',
  time: 1_753_600_000_000,
  depth: 41.7,
  lat: 61.02,
  lon: -150.41,
};

test('earthquake analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, {
    id: 'us7000abcd',
    magnitude: 5.2,
    depthKm: 41.7,
    lat: 61.02,
    lon: -150.41,
    timeMs: 1_753_600_000_000,
    place: '42 km SW of Anchorage, Alaska',
    source: 'USGS',
  });
});

test('earthquake analyst record: source defaults to USGS when absent, passes through when supplied', () => {
  assert.equal(mapAnalystRecord(FULL_RAW).source, 'USGS');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, source: 'EMSC' }).source, 'EMSC');
});

test('earthquake analyst record: missing USGS id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'QUAKE-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'QUAKE-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'QUAKE-0000');
});

test('earthquake analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'us1', mag: NaN, depth: undefined, place: '' }, 0);
  assert.equal(r.magnitude, null);
  assert.equal(r.depthKm, null);
  assert.equal(r.place, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('earthquake analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── EMSC supplemental-source mapping and dedup ──────────────────────────────

const EMSC_FEATURE = {
  id: '20260830_0000123',
  geometry: { type: 'Point', coordinates: [23.7, 38.0, 10] },
  properties: {
    lon: 23.7, lat: 38.0, depth: 10, mag: 4.6,
    time: '2026-08-30T12:00:00.0Z', flynn_region: 'SOUTHERN GREECE', unid: '20260830_0000123',
  },
};

test('mapEmscFeature: maps a well-formed FDSN-event feature', () => {
  assert.deepEqual(mapEmscFeature(EMSC_FEATURE), {
    id: '20260830_0000123', lat: 38.0, lon: 23.7, mag: 4.6,
    depthKm: 10, timeMs: Date.parse('2026-08-30T12:00:00.0Z'), place: 'SOUTHERN GREECE',
  });
});

test('mapEmscFeature: falls back to geometry.coordinates when properties omit lon/lat/depth', () => {
  const r = mapEmscFeature({
    id: 'x1',
    geometry: { coordinates: [10.1, 45.2, 5] },
    properties: { mag: 3.2, time: '2026-08-30T00:00:00Z' },
  });
  assert.equal(r.lon, 10.1);
  assert.equal(r.lat, 45.2);
  assert.equal(r.depthKm, 5);
});

test('mapEmscFeature: rejects a non-ISO-string time (e.g. a raw epoch number) rather than guessing', () => {
  assert.equal(mapEmscFeature({ ...EMSC_FEATURE, properties: { ...EMSC_FEATURE.properties, time: 1_753_600_000_000 } }), null);
  assert.equal(mapEmscFeature({ ...EMSC_FEATURE, properties: { ...EMSC_FEATURE.properties, time: undefined } }), null);
});

test('mapEmscFeature: rejects missing position or magnitude', () => {
  assert.equal(mapEmscFeature({ properties: { mag: 4, time: '2026-08-30T00:00:00Z' } }), null);
  assert.equal(mapEmscFeature({ geometry: { coordinates: [1, 2] }, properties: { time: '2026-08-30T00:00:00Z' } }), null);
  assert.equal(mapEmscFeature(null), null);
});

test('isDuplicateEmscEvent: matches an EMSC report close in space, time, and magnitude to a USGS event', () => {
  const usgsRecords = [{ lat: 38.0, lon: 23.71, mag: 4.5, timeMs: Date.parse('2026-08-30T12:00:10Z') }];
  const candidate = { lat: 38.0, lon: 23.7, mag: 4.6, timeMs: Date.parse('2026-08-30T12:00:00Z') };
  assert.equal(isDuplicateEmscEvent(candidate, usgsRecords), true);
});

test('isDuplicateEmscEvent: a genuinely distinct event (far away) is not a duplicate', () => {
  const usgsRecords = [{ lat: 38.0, lon: 23.7, mag: 4.5, timeMs: Date.parse('2026-08-30T12:00:00Z') }];
  const candidate = { lat: 40.1, lon: -74.0, mag: 4.6, timeMs: Date.parse('2026-08-30T12:00:00Z') };
  assert.equal(isDuplicateEmscEvent(candidate, usgsRecords), false);
});

test('isDuplicateEmscEvent: same place but hours apart, or same time but very different magnitude, is not a duplicate', () => {
  const usgsRecords = [{ lat: 38.0, lon: 23.7, mag: 4.5, timeMs: Date.parse('2026-08-30T12:00:00Z') }];
  assert.equal(isDuplicateEmscEvent(
    { lat: 38.0, lon: 23.7, mag: 4.5, timeMs: Date.parse('2026-08-30T15:00:00Z') },
    usgsRecords,
  ), false, 'three hours apart is not the same event');
  assert.equal(isDuplicateEmscEvent(
    { lat: 38.0, lon: 23.7, mag: 6.5, timeMs: Date.parse('2026-08-30T12:00:00Z') },
    usgsRecords,
  ), false, 'a 2.0 magnitude gap is not the same event');
  assert.deepEqual(isDuplicateEmscEvent({ lat: 0, lon: 0, mag: 1, timeMs: 0 }, null), false);
});

test('real earthquake lifecycle merges a distinct EMSC event and drops a duplicate one', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  globalThis.fetch = async (url) => {
    if (String(url).includes('seismicportal.eu')) {
      return {
        ok: true,
        json: async () => ({
          features: [
            // Duplicate of the USGS event below (same place/time/magnitude).
            {
              id: 'dup-1',
              geometry: { coordinates: [-150.41, 61.02, 41.7] },
              properties: { mag: 5.2, time: '2026-01-01T00:00:00Z', flynn_region: 'ALASKA' },
            },
            // Genuinely distinct event USGS did not report.
            {
              id: 'distinct-1',
              geometry: { coordinates: [23.7, 38.0, 10] },
              properties: { mag: 4.6, time: '2026-08-30T12:00:00Z', flynn_region: 'SOUTHERN GREECE' },
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        features: [{
          id: 'us-dup-1',
          geometry: { coordinates: [-150.41, 61.02, 41.7] },
          properties: { mag: 5.2, place: 'Alaska', time: Date.parse('2026-01-01T00:00:00Z') },
        }],
      }),
    };
  };
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    assert.equal(layer.getStats().count, 2, 'the duplicate EMSC event must not be double-rendered');
    const records = layer.getAnalystRecords();
    assert.deepEqual(records.map((r) => r.source).sort(), ['EMSC', 'USGS']);
    const emscRecord = records.find((r) => r.source === 'EMSC');
    assert.equal(emscRecord.place, 'SOUTHERN GREECE');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('an EMSC fetch failure never affects USGS-backed earthquake availability', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  globalThis.fetch = async (url) => {
    if (String(url).includes('seismicportal.eu')) throw new Error('network unreachable');
    return {
      ok: true,
      json: async () => ({
        features: [{
          id: 'us-solo-1',
          geometry: { coordinates: [-122.4, 37.79, 8.2] },
          properties: { mag: 4.2, place: 'Solo One', time: 1_753_600_000_000 },
        }],
      }),
    };
  };
  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().count, 1);
    assert.equal(layer.getStats().error, null);
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('earthquake overlay copy keeps source-side magnitude formatting and bounded priority', () => {
  const position = Cesium.Cartesian3.fromDegrees(-150.41, 61.02);
  const entry = createEarthquakeOverlayEntry({
    id: 'us7000abcd',
    position,
    magnitude: 5.24,
    accent: '#ff0000',
  });
  assert.equal(entry.title, 'M5.2');
  assert.equal(entry.position, position);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.paintLane, 'ambient-label');
  assert.equal(entry.collisionGroup, 'ambient-label');
  assert.equal(entry.protected, undefined);
  assert.equal(entry.edgeFade, 'keyhole');
  assert.equal(entry.horizonCull, true);

  const entries = Array.from({ length: EARTHQUAKE_OVERLAY_COHORT_LIMIT + 20 }, (_, index) => ({
    id: `quake-${String(index).padStart(3, '0')}`,
    priority: index,
  }));
  const cohort = selectEarthquakeOverlayCohort(entries);
  assert.equal(cohort.length, EARTHQUAKE_OVERLAY_COHORT_LIMIT);
  assert.equal(cohort[0].id, `quake-${EARTHQUAKE_OVERLAY_COHORT_LIMIT + 19}`);
  assert.equal(cohort.at(-1).id, 'quake-020');
});

test('real earthquake lifecycle publishes host labels while runtime entities carry no label graphic', async () => {
  const originalFetch = globalThis.fetch;
  const hostCalls = [];
  const dataSources = [];
  const overlayHost = {
    setEntries: (...args) => hostCalls.push(['entries', ...args]),
    setVisible: (...args) => hostCalls.push(['visible', ...args]),
    clearSource: (...args) => hostCalls.push(['clear', ...args]),
  };
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove(dataSource) {
        const index = dataSources.indexOf(dataSource);
        if (index >= 0) dataSources.splice(index, 1);
        return index >= 0;
      },
    },
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      features: [
        {
          id: 'us-runtime-1',
          geometry: { coordinates: [-150.41, 61.02, 41.7] },
          properties: { mag: 5.24, place: 'Runtime One', time: 1_753_600_000_000 },
        },
        {
          id: 'us-runtime-2',
          geometry: { coordinates: [139.7, 35.6, 310] },
          properties: { mag: 3.01, place: 'Runtime Two', time: 1_753_600_100_000 },
        },
      ],
    }),
  });
  const layer = createEarthquakesLayer({ overlayHost });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = dataSources[0].entities.values;
    assert.equal(entities.length, 2, 'runtime guard requires populated real source entities');
    assert.ok(entities.every((entity) => entity.label === undefined));
    const publication = hostCalls.find(([type]) => type === 'entries');
    assert.ok(publication, 'real update path must publish the overlay source');
    assert.deepEqual(publication[2].map(({ title }) => title), ['M5.2', 'M3.0']);
    assert.deepEqual(publication[3], {
      cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
      collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    });

    layer.disable(viewer);
    assert.equal(dataSources[0].show, false);
    assert.deepEqual(hostCalls.slice(-2), [
      ['clear', 'earthquakes'],
      ['visible', 'earthquakes', false],
    ]);
    layer.destroy(viewer);
    assert.equal(dataSources.length, 0);
    assert.deepEqual(hostCalls.slice(-2), [
      ['clear', 'earthquakes'],
      ['visible', 'earthquakes', false],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Perf pin: the 2026-08-20 earthquakes frame-rate cliff ────────────────────
// Every disc is a CLAMP_TO_GROUND ellipse. When its axes were a
// `CallbackProperty`, Cesium re-tessellated all 58 ground primitives on EVERY
// frame: 32.4 ms/frame and 30 fps for 58 contacts, against 1.4 ms/60 fps with
// the layer off. Static axes restored 60 fps. Both halves of the fix are
// pinned — the runtime property shape, and the source-level guards.
test('quake disc axes are STATIC — a per-frame callback re-tessellates ground geometry', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      features: [{
        id: 'us-static-1',
        geometry: { coordinates: [-122.4, 37.79, 8.2] },
        properties: { mag: 5.5, place: 'Static One', time: 1_753_600_000_000 },
      }],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const [entity] = dataSources[0].entities.values;
    assert.ok(entity.ellipse, 'the disc is an ellipse graphic');
    for (const axis of ['semiMajorAxis', 'semiMinorAxis']) {
      const property = entity.ellipse[axis];
      assert.equal(
        property instanceof Cesium.CallbackProperty,
        false,
        `${axis} must not be a CallbackProperty — it rebuilds the ground primitive every frame`,
      );
      assert.equal(property.isConstant, true, `${axis} must be a constant property`);
      // Magnitude 5.5 → 2^5.5 * 1000 m, unchanged by the dropped pulse.
      assert.equal(property.getValue(Cesium.JulianDate.now()), Math.pow(2, 5.5) * 1000);
    }
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

// Dropping the continuous-render hold is only safe if new poll data still reaches
// the screen. In idle mode nothing repaints on its own, so the manager's one-shot
// request after each tick is now load-bearing for this layer. Wires the REAL layer
// into the REAL manager with the governor installed, rather than trusting the
// arrangement by inspection.
test('a quake poll still reaches the screen with the render loop idle', async () => {
  const originalFetch = globalThis.fetch;
  const renderRequests = [];
  const dataSources = [];
  const viewer = {
    scene: { requestRenderMode: false, requestRender: () => renderRequests.push(Date.now()) },
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      features: [{
        id: 'us-idle-1',
        geometry: { coordinates: [-122.4, 37.79, 8.2] },
        properties: { mag: 4.2, place: 'Idle One', time: 1_753_600_000_000 },
      }],
    }),
  });

  _resetRenderGovernorForTest();
  installRenderGovernor(viewer);
  // Installing the governor enters idle mode, which itself paints one settling
  // frame. Drop that from the baseline or the enable assertion below can pass on
  // the install alone, without the manager ever requesting anything.
  renderRequests.length = 0;
  const manager = new DataLayerManager(viewer);
  // updateInterval -1 keeps the poll loop unarmed; we drive one tick by hand.
  manager.register({ ...layer, updateInterval: -1 });
  try {
    await manager.setEnabled('earthquakes', true, { origin: 'test' });

    // The whole point of the change: enabling quakes must not pin the loop on.
    assert.equal(getRenderGovernorDiagnostics().mode, 'idle', 'quakes must not force continuous render');
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
    assert.equal(viewer.scene.requestRenderMode, true, 'the governor really is in idle mode');

    // ...and the poll that populated the discs must still have asked for a frame,
    // because in idle mode nothing repaints on its own.
    assert.ok(dataSources[0].entities.values.length > 0, 'the enable poll produced discs');
    assert.ok(renderRequests.length > 0, 'enabling the layer must request a render in idle mode');
    // Named, not merely counted: the frame has to come from the manager's
    // visibility request, not from some incidental repaint.
    assert.ok(
      getRenderGovernorDiagnostics().recentRequests.some(({ reason }) => reason === 'layer-visibility'),
      'the enable frame must be the manager\'s layer-visibility request',
    );

    // A LATER poll must request its own frame too — the enable-time
    // 'layer-visibility' request cannot cover refreshes that arrive minutes later.
    const beforeRefresh = renderRequests.length;
    await manager._runPeriodicUpdate('earthquakes', manager.layers.get('earthquakes'));
    assert.ok(
      renderRequests.length > beforeRefresh,
      'each refresh tick must request its own render while the loop is idle',
    );
    const reasons = getRenderGovernorDiagnostics().recentRequests.map(({ reason }) => reason);
    assert.ok(
      reasons.includes('layer-tick:earthquakes'),
      `the tick request must be attributed to the layer, got ${JSON.stringify(reasons)}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await manager.setEnabled('earthquakes', false, { origin: 'test' }).catch(() => {});
    _resetRenderGovernorForTest();
  }
});

test('the earthquakes layer installs no per-frame callback and no continuous-render hold', () => {
  const source = readFileSync(new URL('./earthquakes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /new Cesium\.CallbackProperty/,
    'reverting the discs to a per-frame axis callback must fail this pin',
  );
  assert.doesNotMatch(
    source,
    /holdContinuousRender/,
    'static discs have no per-frame animator, so the layer must not pin the render loop on',
  );
});

test('earthquake refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createEarthquakesLayer({
    overlayHost: { setEntries() {}, setVisible() {}, clearSource() {} },
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'USGS HTTP 503');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ features: [] }),
    });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
