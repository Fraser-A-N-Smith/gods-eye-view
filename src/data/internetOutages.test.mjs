// src/data/internetOutages.test.mjs
// Focused tests for the analyst-record mapper (analyst query engine seam)
// plus lifecycle tests against a mocked /api/internet-outages proxy
// response. The IODA/OONI filter/mapping CONTRACT itself
// (mapIodaAlert/mapOoniAggregateRow) is tested once, in
// internetOutagesShape.test.mjs, against the single shared implementation
// both this layer and vite.config.js's proxy import from
// internetOutagesShape.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import * as InternetOutagesShape from './internetOutagesShape.js';
import {
  createInternetOutagesLayer,
  mapAnalystRecord,
  mapIodaAlert,
  mapOoniAggregateRow,
} from './internetOutages.js';

const FULL_RAW = {
  id: 'ioda:bgp:MV:1572825600',
  source: 'IODA',
  countryCode: 'MV',
  countryName: 'Maldives',
  lat: 3.5,
  lon: 73.1,
  kind: 'bgp',
  severity: 'Orange',
  dateMs: 1572825600000,
};

test('internet outages analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, FULL_RAW);
});

test('internet outages analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'OUTAGE-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'OUTAGE-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'OUTAGE-0000');
});

test('internet outages analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: 'x1', source: '', countryCode: undefined, lat: NaN, dateMs: undefined }, 0);
  assert.equal(r.source, null);
  assert.equal(r.countryCode, null);
  assert.equal(r.lat, null);
  assert.equal(r.dateMs, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('internet outages analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── Re-export wiring ────────────────────────────────────────────────────────

test('internetOutages.js re-exports the SAME mapIodaAlert/mapOoniAggregateRow functions internetOutagesShape.js implements', () => {
  assert.equal(mapIodaAlert, InternetOutagesShape.mapIodaAlert);
  assert.equal(mapOoniAggregateRow, InternetOutagesShape.mapOoniAggregateRow);
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

test('internet outages lifecycle populates entities from the merged proxy payload', async () => {
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
      outages: [
        {
          id: 'ioda:bgp:MV:1', source: 'IODA', countryCode: 'MV', countryName: 'Maldives',
          lat: 3.5, lon: 73.1, kind: 'bgp', severity: 'Red', dateMs: 1_753_600_000_000,
        },
        {
          id: 'ooni:IR', source: 'OONI', countryCode: 'IR', countryName: 'Iran',
          lat: 32.4, lon: 53.7, kind: 'censorship', severity: 'Orange', dateMs: 1_753_600_100_000,
        },
      ],
      retrievedAt: Date.now(),
    }),
  });
  const layer = createInternetOutagesLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.equal(await layer.update(viewer), true);

    const entities = dataSources[0].entities.values;
    assert.equal(entities.length, 2, 'both merged signals must land as entities');
    assert.ok(entities.every((entity) => entity.point !== undefined), 'each signal is a point graphic');
    assert.ok(entities.every((entity) => entity.label !== undefined), 'each signal carries a country/kind label');
    assert.deepEqual(
      entities.map((entity) => entity.label.text.getValue()).sort(),
      ['IR · CENSORSHIP', 'MV · OUTAGE'],
    );

    const redEntity = entities.find((entity) => entity.id === 'internet-outage:ioda:bgp:MV:1');
    const orangeEntity = entities.find((entity) => entity.id === 'internet-outage:ooni:IR');
    assert.ok(redEntity && orangeEntity, 'both styled entities must be found by id');
    assert.ok(
      redEntity.point.pixelSize.getValue() > orangeEntity.point.pixelSize.getValue(),
      'Red severity must render bigger than Orange',
    );

    assert.equal(layer.getStats().count, 2);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
    assert.equal(layer.getStats().error, null);

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((r) => r.source).sort(), ['IODA', 'OONI']);

    layer.disable(viewer);
    assert.equal(dataSources[0].show, false);
    layer.destroy(viewer);
    assert.equal(dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('internet outages refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const dataSources = [];
  const viewer = {
    dataSources: {
      add(dataSource) { dataSources.push(dataSource); return dataSource; },
      remove() { return true; },
    },
  };
  const layer = createInternetOutagesLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Internet Outages HTTP 503');

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ outages: [] }),
    });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
