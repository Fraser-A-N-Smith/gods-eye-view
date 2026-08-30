// src/data/globalHazards.test.mjs
// Focused tests for the pure mapper/filter functions (analyst query engine
// seam and the GDACS/EONET filter contract), plus lifecycle tests against a
// mocked /api/global-hazards proxy response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

// ── GDACS filter/mapping contract ─────────────────────────────────────────

test('mapGdacsFeature: keeps only FL/DR, current, non-Green events', () => {
  const base = {
    geometry: { coordinates: [56.78, 12.34] },
    properties: {
      eventtype: 'FL', eventid: '12345', name: 'Flood', alertlevel: 'Red',
      iscurrent: 'true', datemodified: '2026-08-20T00:00:00Z',
      url: { report: 'https://gdacs.org/report/12345' },
    },
  };
  const kept = mapGdacsFeature(base);
  assert.deepEqual(kept, {
    id: 'gdacs:FL:12345',
    source: 'GDACS',
    kind: 'FL',
    title: 'Flood',
    lat: 12.34,
    lon: 56.78,
    severity: 'Red',
    url: 'https://gdacs.org/report/12345',
    dateMs: Date.parse('2026-08-20T00:00:00Z'),
  });

  for (const eventtype of ['EQ', 'TC', 'WF', 'VO']) {
    assert.equal(mapGdacsFeature({
      ...base,
      properties: { ...base.properties, eventtype },
    }), null, `${eventtype} duplicates a dedicated layer and must be dropped`);
  }
  assert.equal(mapGdacsFeature({
    ...base,
    properties: { ...base.properties, alertlevel: 'Green' },
  }), null, 'Green alert level is routine noise and must be dropped');
  assert.equal(mapGdacsFeature({
    ...base,
    properties: { ...base.properties, iscurrent: 'false' },
  }), null, 'non-current episodes must be dropped');
  assert.equal(mapGdacsFeature({
    ...base,
    geometry: { coordinates: ['not-a-number', 12.34] },
  }), null, 'non-finite coordinates must be dropped');
  assert.equal(mapGdacsFeature(null), null);
  assert.equal(mapGdacsFeature({}), null);
});

// ── EONET filter/mapping contract ─────────────────────────────────────────

test('mapEonetFeature: keeps only allow-listed categories and the LAST geometry point', () => {
  const base = {
    id: 'EONET_1234',
    title: 'Severe Storm Test',
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1234',
    categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    geometry: [
      { date: '2026-08-18T00:00:00Z', type: 'Point', coordinates: [10, 20] },
      { date: '2026-08-20T00:00:00Z', type: 'Point', coordinates: [11, 21] },
    ],
  };
  const kept = mapEonetFeature(base);
  assert.deepEqual(kept, {
    id: 'eonet:EONET_1234',
    source: 'EONET',
    kind: 'severeStorms',
    title: 'Severe Storm Test',
    lat: 21,
    lon: 11,
    severity: 'Orange',
    url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1234',
    dateMs: Date.parse('2026-08-20T00:00:00Z'),
  });

  for (const categoryId of ['wildfires', 'volcanoes', 'earthquakes', 'floods']) {
    assert.equal(mapEonetFeature({
      ...base,
      categories: [{ id: categoryId, title: categoryId }],
    }), null, `${categoryId} duplicates a dedicated layer and must be dropped`);
  }
  assert.equal(mapEonetFeature({ ...base, categories: [] }), null, 'no category must be dropped');
  assert.equal(mapEonetFeature({ ...base, geometry: [] }), null, 'no geometry must be dropped');
  assert.equal(mapEonetFeature(null), null);
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
