// src/data/globalHazards.test.mjs
// Focused tests for the analyst-record mapper (analyst query engine seam)
// plus lifecycle tests against a mocked /api/global-hazards proxy response.
// The GDACS/EONET filter/mapping CONTRACT itself (mapGdacsFeature/
// mapEonetFeature) is tested once, in globalHazardsShape.test.mjs, against
// the single shared implementation both this layer and vite.config.js's
// proxy import from globalHazardsShape.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import * as GlobalHazardsShape from './globalHazardsShape.js';
import {
  createGlobalHazardsLayer,
  mapAnalystRecord,
  mapEonetFeature,
  mapGdacsFeature,
} from './globalHazards.js';

const FULL_RAW = {
  id: 'gdacs:FL:12345',
  source: 'GDACS',
  kind: 'FL',
  title: 'Flood in Test Country',
  lat: 12.34,
  lon: 56.78,
  severity: 'Red',
  dateMs: 1_753_600_000_000,
};

test('global hazards analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, {
    id: 'gdacs:FL:12345',
    source: 'GDACS',
    kind: 'FL',
    title: 'Flood in Test Country',
    lat: 12.34,
    lon: 56.78,
    severity: 'Red',
    dateMs: 1_753_600_000_000,
  });
});

test('global hazards analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'HAZARD-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'HAZARD-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'HAZARD-0000');
});

test('global hazards analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'x1', source: '', kind: undefined, title: '', lat: NaN, dateMs: undefined }, 0);
  assert.equal(r.source, null);
  assert.equal(r.kind, null);
  assert.equal(r.title, null);
  assert.equal(r.lat, null);
  assert.equal(r.dateMs, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('global hazards analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── Re-export wiring ────────────────────────────────────────────────────────
// Not a re-test of the filter contract (that lives once in
// globalHazardsShape.test.mjs) — just confirms globalHazards.js's exported
// mapGdacsFeature/mapEonetFeature really are the shared implementation by
// reference, not a second copy that happens to look similar.

test('globalHazards.js re-exports the SAME mapGdacsFeature/mapEonetFeature functions globalHazardsShape.js implements', () => {
  assert.equal(mapGdacsFeature, GlobalHazardsShape.mapGdacsFeature);
  assert.equal(mapEonetFeature, GlobalHazardsShape.mapEonetFeature);
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

test('global hazards lifecycle populates entities from the merged proxy payload', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
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
      hazards: [
        {
          id: 'gdacs:FL:1', source: 'GDACS', kind: 'FL', title: 'Flood One',
          lat: 12.34, lon: 56.78, severity: 'Red', url: null, dateMs: 1_753_600_000_000,
        },
        {
          id: 'eonet:EONET_2', source: 'EONET', kind: 'severeStorms', title: 'Storm Two',
          lat: -10, lon: 20, severity: 'Orange', url: null, dateMs: 1_753_600_100_000,
        },
      ],
      retrievedAt: Date.now(),
    }),
  });
  const layer = createGlobalHazardsLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.equal(await layer.update(viewer), true);

    const entities = dataSources[0].entities.values;
    assert.equal(entities.length, 2, 'both merged hazards must land as entities');
    assert.ok(entities.every((entity) => entity.point !== undefined), 'each hazard is a point graphic, not an ellipse');
    assert.ok(entities.every((entity) => entity.label !== undefined), 'each hazard carries a kind label');
    assert.deepEqual(
      entities.map((entity) => entity.label.text.getValue()).sort(),
      ['FL', 'severeStorms'],
    );

    // Severity styling: Red reads bigger and red, Orange smaller and orange —
    // asserted by entity, not just exercised, so a styling regression fails here.
    const redEntity = entities.find((entity) => entity.id === 'hazard:gdacs:FL:1');
    const orangeEntity = entities.find((entity) => entity.id === 'hazard:eonet:EONET_2');
    assert.ok(redEntity && orangeEntity, 'both styled entities must be found by id');
    const redPixelSize = redEntity.point.pixelSize.getValue();
    const orangePixelSize = orangeEntity.point.pixelSize.getValue();
    assert.ok(redPixelSize > orangePixelSize, 'Red severity must render bigger than Orange');
    assert.ok(redEntity.point.color.getValue().equals(Cesium.Color.RED), 'Red severity must render red');
    assert.ok(orangeEntity.point.color.getValue().equals(Cesium.Color.ORANGE), 'Orange severity must render orange');

    assert.equal(layer.getStats().count, 2);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
    assert.equal(layer.getStats().error, null);

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((r) => r.id).sort(), ['eonet:EONET_2', 'gdacs:FL:1']);

    layer.disable(viewer);
    assert.equal(dataSources[0].show, false);
    layer.destroy(viewer);
    assert.equal(dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('global hazards refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createGlobalHazardsLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Global Hazards HTTP 503');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ hazards: [] }),
    });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
