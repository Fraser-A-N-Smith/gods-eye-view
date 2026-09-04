// src/data/volcanoes.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine
// seam) plus lifecycle coverage with a mocked fetch, mirroring the earthquakes
// layer's test style. Filter/mapping logic itself is covered once, against
// its one real implementation, in volcanoesShape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import * as VolcanoesShape from './volcanoesShape.js';
import { createVolcanoesLayer, mapAnalystRecord, mapVolcanoFeature } from './volcanoes.js';

const FULL_RAW = {
  id: 'gvp:332010',
  name: 'Kilauea',
  lat: 19.42,
  lon: -155.28,
  lastEruptionYear: 2024,
  country: 'United States',
  volcanoType: 'Shield',
  elevationM: 1222,
};

test('volcano analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, {
    id: 'gvp:332010',
    name: 'Kilauea',
    lat: 19.42,
    lon: -155.28,
    lastEruptionYear: 2024,
    country: 'United States',
    volcanoType: 'Shield',
    elevationM: 1222,
    alertLevel: null,
    colorCode: null,
    alertUpdatedAt: null,
  });
});

test('volcano analyst record: passes through a live alert enrichment when present', () => {
  const r = mapAnalystRecord({ ...FULL_RAW, alertLevel: 'WATCH', colorCode: 'ORANGE', alertUpdatedAt: '2026-08-30T00:00:00.000Z' });
  assert.equal(r.alertLevel, 'WATCH');
  assert.equal(r.colorCode, 'ORANGE');
  assert.equal(r.alertUpdatedAt, '2026-08-30T00:00:00.000Z');
});

test('volcano analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'VOLCANO-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'VOLCANO-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'VOLCANO-0000');
});

test('volcano analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'gvp:1', name: '', lastEruptionYear: NaN, elevationM: undefined }, 0);
  assert.equal(r.name, null);
  assert.equal(r.lastEruptionYear, null);
  assert.equal(r.elevationM, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('volcano analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── Re-export wiring ────────────────────────────────────────────────────────
// Not a re-test of the filter contract (that lives once in
// volcanoesShape.test.mjs) — just confirms volcanoes.js's exported
// mapVolcanoFeature really is the shared implementation by reference, not a
// second copy that happens to look similar.

test('volcanoes.js re-exports the SAME mapVolcanoFeature function volcanoesShape.js implements', () => {
  assert.equal(mapVolcanoFeature, VolcanoesShape.mapVolcanoFeature);
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

function volcanoPayload(overrides) {
  return {
    volcanoes: [
      {
        id: 'gvp:1', name: 'Red One', lat: 10, lon: 20,
        lastEruptionYear: 2015, country: 'A', volcanoType: 'Stratovolcano', elevationM: 1000,
      },
      {
        id: 'gvp:2', name: 'Orange One', lat: 11, lon: 21,
        lastEruptionYear: 1960, country: 'B', volcanoType: 'Shield', elevationM: 2000,
      },
      {
        id: 'gvp:3', name: 'Yellow One', lat: 12, lon: 22,
        lastEruptionYear: 1920, country: 'C', volcanoType: 'Caldera', elevationM: 3000,
      },
      ...(overrides || []),
    ],
  };
}

test('volcano color bands: 2015 is red, 1960 is orange, 1920 is yellow', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createVolcanoesLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => volcanoPayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    assert.equal(entities.length, 3);
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();

    assert.ok(byId['volcano:gvp:1'].point.color.getValue(now).equals(Cesium.Color.RED));
    assert.ok(byId['volcano:gvp:2'].point.color.getValue(now).equals(Cesium.Color.ORANGE));
    assert.ok(byId['volcano:gvp:3'].point.color.getValue(now).equals(Cesium.Color.YELLOW));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('a live WATCH/WARNING alert overrides eruption-recency coloring and appends a label suffix', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createVolcanoesLayer();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      volcanoes: [
        // Would otherwise be YELLOW (1920) — WARNING must override to RED/16px.
        { id: 'gvp:1', name: 'Old But Warning', lat: 10, lon: 20, lastEruptionYear: 1920, alertLevel: 'WARNING' },
        // Would otherwise be YELLOW (1920) — WATCH must override to ORANGE/14px.
        { id: 'gvp:2', name: 'Old But Watch', lat: 11, lon: 21, lastEruptionYear: 1920, alertLevel: 'WATCH' },
        // ADVISORY is not WATCH/WARNING — falls through to recency coloring unchanged.
        { id: 'gvp:3', name: 'Advisory Only', lat: 12, lon: 22, lastEruptionYear: 1920, alertLevel: 'ADVISORY' },
      ],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();

    assert.ok(byId['volcano:gvp:1'].point.color.getValue(now).equals(Cesium.Color.RED));
    assert.equal(byId['volcano:gvp:1'].point.pixelSize.getValue(now), 16);
    assert.equal(byId['volcano:gvp:1'].label.text.getValue(now), 'Old But Warning [WARNING]');

    assert.ok(byId['volcano:gvp:2'].point.color.getValue(now).equals(Cesium.Color.ORANGE));
    assert.equal(byId['volcano:gvp:2'].point.pixelSize.getValue(now), 14);
    assert.equal(byId['volcano:gvp:2'].label.text.getValue(now), 'Old But Watch [WATCH]');

    assert.ok(
      byId['volcano:gvp:3'].point.color.getValue(now).equals(Cesium.Color.YELLOW),
      'ADVISORY is not a color-override level — recency coloring applies unchanged',
    );
    // The label suffix is broader than the color override: any active,
    // non-NORMAL level is worth telling the analyst about in the label text,
    // even when it isn't strong enough to override the point's color/size.
    assert.equal(byId['volcano:gvp:3'].label.text.getValue(now), 'Advisory Only [ADVISORY]');

    const records = layer.getAnalystRecords();
    assert.equal(records.find((r) => r.name === 'Old But Warning').alertLevel, 'WARNING');
    assert.equal(records.find((r) => r.name === 'Advisory Only').alertLevel, 'ADVISORY');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('real volcano lifecycle: init/enable/update/disable/destroy', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createVolcanoesLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => volcanoPayload() });
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
    assert.ok(entity.point, 'volcanoes render as points');
    assert.ok(entity.label, 'volcanoes carry a name label');

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.name).sort(), ['Orange One', 'Red One', 'Yellow One']);

    layer.disable(viewer);
    assert.equal(viewer._dataSources[0].show, false);
    assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layer reports no records');

    layer.destroy(viewer);
    assert.equal(viewer._dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('volcano refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createVolcanoesLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Volcanoes HTTP 503');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ volcanoes: [] }) });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('volcano refresh rejects a malformed payload without throwing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createVolcanoesLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notVolcanoes: [] }) });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Malformed volcanoes response');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
