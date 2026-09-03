// src/data/diseaseOutbreaks.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine
// seam) plus lifecycle coverage with a mocked fetch, mirroring the
// volcanoes/earthquakes layer test style. The country-resolution/mapping
// contract itself is covered once, against its one real implementation, in
// diseaseOutbreaksShape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createDiseaseOutbreaksLayer, mapAnalystRecord } from './diseaseOutbreaks.js';

const FULL_RAW = {
  id: 'who-don:marburg-virus-disease-rwanda',
  title: 'Marburg virus disease – Rwanda',
  country: 'Rwanda',
  lat: -1.94,
  lon: 30.06,
  publishedAt: '2026-08-15T00:00:00.000Z',
  url: 'https://www.who.int/emergencies/disease-outbreak-news/item/marburg-virus-disease-rwanda',
};

test('outbreak analyst record: full record maps every contract field', () => {
  assert.deepEqual(mapAnalystRecord(FULL_RAW, 3), FULL_RAW);
});

test('outbreak analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'OUTBREAK-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'OUTBREAK-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'OUTBREAK-0000');
});

test('outbreak analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'x1', title: '', lat: NaN, url: undefined }, 0);
  assert.equal(r.title, null);
  assert.equal(r.lat, null);
  assert.equal(r.url, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('outbreak analyst record: output is JSON-safe', () => {
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

function outbreakPayload(overrides) {
  return {
    outbreaks: [
      { id: 'recent-1', title: 'Recent One', country: 'Kenya', lat: -1.29, lon: 36.82, publishedAt: new Date().toISOString() },
      { id: 'old-1', title: 'Old One', country: 'Nigeria', lat: 9.08, lon: 7.40, publishedAt: '2020-01-01T00:00:00.000Z' },
      { id: 'undated-1', title: 'Undated One', country: 'Ghana', lat: 5.60, lon: -0.19, publishedAt: null },
      ...(overrides || []),
    ],
  };
}

test('outbreak recency color bands: recent is red, old is yellow, undated is treated as old', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createDiseaseOutbreaksLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => outbreakPayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    assert.equal(entities.length, 3);
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();

    assert.ok(byId['outbreak:recent-1'].point.color.getValue(now).equals(Cesium.Color.RED));
    assert.ok(byId['outbreak:old-1'].point.color.getValue(now).equals(Cesium.Color.YELLOW));
    assert.ok(byId['outbreak:undated-1'].point.color.getValue(now).equals(Cesium.Color.YELLOW), 'no timestamp reads as old, not recent');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('real disease outbreaks lifecycle: init/enable/update/disable/destroy', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createDiseaseOutbreaksLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => outbreakPayload() });
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
    assert.ok(entity.point, 'outbreaks render as points');
    assert.ok(entity.label, 'outbreaks carry a title label');

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.country).sort(), ['Ghana', 'Kenya', 'Nigeria']);

    layer.disable(viewer);
    assert.equal(viewer._dataSources[0].show, false);
    assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layer reports no records');

    layer.destroy(viewer);
    assert.equal(viewer._dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('disease outbreaks refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createDiseaseOutbreaksLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Disease Outbreaks HTTP 503');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ outbreaks: [] }) });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('disease outbreaks refresh rejects a malformed payload without throwing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createDiseaseOutbreaksLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notOutbreaks: [] }) });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Malformed disease outbreaks response');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
