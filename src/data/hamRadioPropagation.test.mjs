// src/data/hamRadioPropagation.test.mjs
// Focused tests for the pure analyst-record mapper (analyst query engine
// seam) plus lifecycle coverage with a mocked fetch, mirroring the ocean
// buoys/volcanoes layer test style. The Maidenhead decoder and PSKReporter
// XML parser contract itself is covered once, against its one real
// implementation, in hamRadioPropagationShape.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import * as HamRadioPropagationShape from './hamRadioPropagationShape.js';
import {
  createHamRadioPropagationLayer,
  mapAnalystRecord,
  maidenheadToLatLon,
  parsePskReporterXml,
} from './hamRadioPropagation.js';

const FULL_RAW = {
  id: 'CU2AP-PE1OID-1788091549',
  senderCallsign: 'CU2AP',
  receiverCallsign: 'PE1OID',
  senderLat: 39.5,
  senderLon: -31.0,
  receiverLat: 52.3,
  receiverLon: 4.9,
  frequencyHz: 18102364,
  mode: 'FT8',
  snr: -13,
};

test('ham radio analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, { ...FULL_RAW });
});

test('ham radio analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'SPOT-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'SPOT-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'SPOT-0000');
});

test('ham radio analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: '1', snr: NaN, frequencyHz: undefined }, 0);
  assert.equal(r.snr, null);
  assert.equal(r.frequencyHz, null);
  assert.equal(r.senderCallsign, null);
  assert.equal(r.receiverLat, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('ham radio analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── Re-export wiring ────────────────────────────────────────────────────────
// Not a re-test of the decoder/parser contract (that lives once in
// hamRadioPropagationShape.test.mjs) — just confirms hamRadioPropagation.js's
// exported maidenheadToLatLon/parsePskReporterXml really are the shared
// implementation by reference, not a second copy that happens to look
// similar (this is also what the server proxy in vite.config.js imports).

test('hamRadioPropagation.js re-exports the SAME maidenheadToLatLon/parsePskReporterXml functions hamRadioPropagationShape.js implements', () => {
  assert.equal(maidenheadToLatLon, HamRadioPropagationShape.maidenheadToLatLon);
  assert.equal(parsePskReporterXml, HamRadioPropagationShape.parsePskReporterXml);
});

test('updateInterval honors PSKReporter\'s no-more-than-once-per-5-minutes polling policy', () => {
  assert.equal(createHamRadioPropagationLayer().updateInterval, 300000);
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

function spotsPayload(overrides) {
  return {
    spots: [
      {
        id: 'spot-1', senderCallsign: 'AA1AA', receiverCallsign: 'BB1BB',
        senderLat: 40, senderLon: -74, receiverLat: 51, receiverLon: 0,
        frequencyHz: 14074000, mode: 'FT8', snr: 15,
      },
      {
        id: 'spot-2', senderCallsign: 'CC1CC', receiverCallsign: 'DD1DD',
        senderLat: 35, senderLon: 139, receiverLat: -33, receiverLon: 151,
        frequencyHz: 7074000, mode: 'FT8', snr: -20,
      },
      {
        id: 'spot-3', senderCallsign: 'EE1EE', receiverCallsign: 'FF1FF',
        senderLat: -1, senderLon: 36, receiverLat: 48, receiverLon: 2,
        frequencyHz: 21074000, mode: 'FT8', snr: 0,
      },
      ...(overrides || []),
    ],
  };
}

test('ham radio SNR styling: higher SNR renders brighter than lower SNR', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createHamRadioPropagationLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => spotsPayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    assert.equal(entities.length, 3);
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();

    const strong = byId['ham-radio:spot-1'].polyline.material.color.getValue(now).alpha; // snr 15
    const weak = byId['ham-radio:spot-2'].polyline.material.color.getValue(now).alpha; // snr -20
    assert.ok(strong > weak, 'a stronger SNR spot must render more opaque/brighter than a weak one');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('ham radio spots render as static-position polylines, not CallbackProperty arcs', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createHamRadioPropagationLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => spotsPayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const [entity] = viewer._dataSources[0].entities.values;
    assert.ok(entity.polyline, 'spots render as polylines, not points');
    assert.ok(Array.isArray(entity.polyline.positions.getValue()), 'positions resolve to a plain array');
    assert.equal(entity.polyline.positions.getValue().length, 2, 'a polyline arc has exactly two endpoints');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('real ham radio propagation lifecycle: init/enable/update/disable/destroy', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createHamRadioPropagationLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => spotsPayload() });
  try {
    layer.init(viewer);
    assert.equal(viewer._dataSources[0].show, false, 'starts hidden');
    layer.enable(viewer);
    assert.equal(viewer._dataSources[0].show, true);

    await layer.update(viewer);
    assert.equal(layer.getStats().count, 3);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
    assert.equal(layer.getStats().error, null);

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.id).sort(), ['spot-1', 'spot-2', 'spot-3']);

    layer.disable(viewer);
    assert.equal(viewer._dataSources[0].show, false);
    assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layer reports no records');

    layer.destroy(viewer);
    assert.equal(viewer._dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ham radio spots sharing sender/receiver/flowStartSeconds but differing in frequency both land, without entities.add() throwing on a duplicate id', async () => {
  // Regression: the proxy has no band filter and FT8's decode windows are
  // globally time-synchronized, so the same station pair decoded
  // simultaneously on two bands is real, common upstream data. Before the
  // fix, both spots synthesized the SAME id (frequency was omitted), and
  // Cesium's entities.add() throws a DeveloperError on a duplicate id —
  // which update()'s catch then swallowed and misreported as a network
  // error, after removeAll() had already cleared the prior batch.
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createHamRadioPropagationLayer();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      spots: [
        {
          id: 'B-A-1788091549-14074000', senderCallsign: 'B', receiverCallsign: 'A',
          senderLat: 40.5, senderLon: -75, receiverLat: 52.3, receiverLon: 4.9,
          frequencyHz: 14074000, mode: 'FT8', snr: 5, flowStartSeconds: 1788091549,
        },
        {
          id: 'B-A-1788091549-7074000', senderCallsign: 'B', receiverCallsign: 'A',
          senderLat: 40.5, senderLon: -75, receiverLat: 52.3, receiverLon: 4.9,
          frequencyHz: 7074000, mode: 'FT8', snr: -3, flowStartSeconds: 1788091549,
        },
      ],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    const ok = await layer.update(viewer);
    assert.equal(ok, true, 'update() must not fail/throw on same-pair-different-band spots');
    assert.equal(layer.getStats().error, null);
    assert.equal(layer.getStats().count, 2, 'both bands must render as separate entities');
    assert.equal(viewer._dataSources[0].entities.values.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('ham radio spots missing an endpoint coordinate are skipped without crashing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createHamRadioPropagationLayer();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      spots: [
        { id: 'bad', senderCallsign: 'X', receiverCallsign: 'Y', senderLat: 'unknown', senderLon: -74, receiverLat: 51, receiverLon: 0, mode: 'FT8', snr: 0 },
        { id: 'good', senderCallsign: 'A', receiverCallsign: 'B', senderLat: 40, senderLon: -74, receiverLat: 51, receiverLon: 0, mode: 'FT8', snr: 5 },
      ],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);
    assert.equal(layer.getStats().count, 1);
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('ham radio refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createHamRadioPropagationLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Ham Radio HTTP 503');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ spots: [] }) });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('ham radio refresh rejects a malformed payload without throwing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createHamRadioPropagationLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notSpots: [] }) });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Malformed ham radio response');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
