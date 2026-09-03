// src/data/borderWaitTimes.test.mjs
// Focused tests for the pure join/map function (analyst query engine seam
// plus the server proxy's own mapping), analyst-record mapping, lifecycle
// coverage with a mocked fetch, and a guard on the bundled static locations
// config — mirroring the volcanoes/earthquakes/oceanBuoys layer test style.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import * as BorderWaitTimesShape from './borderWaitTimesShape.js';
import {
  createBorderWaitTimesLayer,
  mapAnalystRecord,
  mapWaitTimeEntry,
  mapWaitTimeEntries,
} from './borderWaitTimes.js';

const LOCATIONS = { '070801': { name: 'Alexandria Bay', lat: 44.339, lon: -75.918 } };

// ── mapWaitTimeEntry (brief contract) ───────────────────────────────────────

test('mapWaitTimeEntry: matched port maps wait minutes and status', () => {
  const entry = {
    port_number: '070801', border: 'Canadian Border', port_status: 'Open',
    passenger_vehicle_lanes: { standard_lanes: { delay_minutes: '15' } },
  };
  assert.deepEqual(mapWaitTimeEntry(entry, LOCATIONS), {
    id: '070801', name: 'Alexandria Bay', border: 'Canadian Border',
    lat: 44.339, lon: -75.918, waitMinutes: 15, status: 'Open',
  });
});

test('mapWaitTimeEntry: unmatched port_number returns null', () => {
  assert.equal(mapWaitTimeEntry({ port_number: '999999' }, LOCATIONS), null);
});

test('mapWaitTimeEntry: a port_number that names an Object.prototype key does not resolve to a method', () => {
  // `locations?.[portNumber]` on a JSON.parse'd plain object would resolve
  // "constructor" to Object itself — a real record escaping the join with
  // name/lat/lon all undefined instead of being dropped as unmatched.
  // Object.hasOwn (used internally by mapWaitTimeEntry) closes that off.
  for (const portNumber of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(
      mapWaitTimeEntry({ port_number: portNumber }, LOCATIONS),
      null,
      `port_number "${portNumber}" must be treated as unmatched, not resolve via the prototype chain`,
    );
  }
});

test('mapWaitTimeEntry: empty-string delay_minutes becomes null, not NaN', () => {
  const entry = {
    port_number: '070801', border: 'Canadian Border', port_status: 'Open',
    passenger_vehicle_lanes: { standard_lanes: { delay_minutes: '' } },
  };
  assert.equal(mapWaitTimeEntry(entry, LOCATIONS).waitMinutes, null);
});

test('mapWaitTimeEntry: missing port_number returns null (no throw)', () => {
  assert.equal(mapWaitTimeEntry({}, LOCATIONS), null);
  assert.equal(mapWaitTimeEntry(null, LOCATIONS), null);
  assert.equal(mapWaitTimeEntry(undefined, LOCATIONS), null);
});

test('mapWaitTimeEntry: missing nested delay_minutes path becomes null, not throw', () => {
  const entry = { port_number: '070801', border: 'Canadian Border', port_status: 'Open' };
  assert.equal(mapWaitTimeEntry(entry, LOCATIONS).waitMinutes, null);
});

// ── mapWaitTimeEntries (array join, used by the proxy) ──────────────────────

test('mapWaitTimeEntries: drops unmatched entries, keeps matched ones', () => {
  const entries = [
    { port_number: '070801', border: 'Canadian Border', port_status: 'Open',
      passenger_vehicle_lanes: { standard_lanes: { delay_minutes: '5' } } },
    { port_number: '999999', border: 'Mexican Border', port_status: 'Open' },
  ];
  const mapped = mapWaitTimeEntries(entries, LOCATIONS);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].id, '070801');
});

test('mapWaitTimeEntries: non-array input returns []', () => {
  assert.deepEqual(mapWaitTimeEntries(null, LOCATIONS), []);
  assert.deepEqual(mapWaitTimeEntries(undefined, LOCATIONS), []);
});

// ── Re-export wiring ─────────────────────────────────────────────────────────
// Not a re-test of the join contract (that lives once above, against its one
// real implementation) — just confirms borderWaitTimes.js's exported
// mapWaitTimeEntry/mapWaitTimeEntries really are the shared implementation by
// reference, not a second copy that happens to look similar.

test('borderWaitTimes.js re-exports the SAME mapWaitTimeEntry/mapWaitTimeEntries functions borderWaitTimesShape.js implements', () => {
  assert.equal(mapWaitTimeEntry, BorderWaitTimesShape.mapWaitTimeEntry);
  assert.equal(mapWaitTimeEntries, BorderWaitTimesShape.mapWaitTimeEntries);
});

// ── mapAnalystRecord ─────────────────────────────────────────────────────────

const FULL_RAW = {
  id: '070801',
  name: 'Alexandria Bay',
  border: 'Canadian Border',
  lat: 44.339,
  lon: -75.918,
  waitMinutes: 15,
  status: 'Open',
};

test('crossing analyst record: full record maps every contract field', () => {
  const r = mapAnalystRecord(FULL_RAW, 3);
  assert.deepEqual(r, { ...FULL_RAW });
});

test('crossing analyst record: missing id falls back to index-based id', () => {
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: null }, 3).id, 'CROSSING-0003');
  assert.equal(mapAnalystRecord({ ...FULL_RAW, id: '  ' }, 41).id, 'CROSSING-0041');
  assert.equal(mapAnalystRecord(undefined).id, 'CROSSING-0000');
});

test('crossing analyst record: missing fields become null, never NaN/undefined', () => {
  const r = mapAnalystRecord({ id: '070801', waitMinutes: NaN, name: undefined }, 0);
  assert.equal(r.waitMinutes, null);
  assert.equal(r.name, null);
  assert.equal(r.border, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('crossing analyst record: output is JSON-safe (no Cesium types)', () => {
  const r = mapAnalystRecord(FULL_RAW, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── config/cbp_port_locations.json guard ────────────────────────────────────
// A wrong crossing coordinate is a silent, hard-to-catch data-quality bug in
// a way a missing crossing is not. This asserts the file parses and every
// entry is within valid lat/lon range AND within plausible bounds for a US
// land border crossing — a transposed or sign-flipped coordinate (e.g. a
// swapped lat/lon or a dropped minus sign) would sail through the generic
// -90..90/-180..180 check but not this one.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCATIONS_PATH = path.join(__dirname, '..', '..', 'config', 'cbp_port_locations.json');

test('config/cbp_port_locations.json parses as valid JSON', () => {
  const raw = fs.readFileSync(LOCATIONS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed, 'object');
  assert.ok(parsed && !Array.isArray(parsed));
  assert.ok(Object.keys(parsed).length > 0, 'must not be empty');
});

test('config/cbp_port_locations.json: every entry has a name and finite lat/lon within valid range', () => {
  const parsed = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf8'));
  for (const [portNumber, entry] of Object.entries(parsed)) {
    assert.equal(typeof entry.name, 'string', `${portNumber}: name must be a string`);
    assert.ok(entry.name.trim().length > 0, `${portNumber}: name must not be blank`);
    assert.ok(Number.isFinite(entry.lat), `${portNumber}: lat must be finite`);
    assert.ok(Number.isFinite(entry.lon), `${portNumber}: lon must be finite`);
    assert.ok(entry.lat >= -90 && entry.lat <= 90, `${portNumber}: lat ${entry.lat} out of range`);
    assert.ok(entry.lon >= -180 && entry.lon <= 180, `${portNumber}: lon ${entry.lon} out of range`);
  }
});

test('config/cbp_port_locations.json: every entry falls within plausible US land-border bounds', () => {
  // Roughly the contiguous US + Alaska panhandle border band. Catches a
  // transposed or sign-flipped coordinate that would otherwise sail through
  // the generic -90..90/-180..180 check above.
  const parsed = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf8'));
  for (const [portNumber, entry] of Object.entries(parsed)) {
    assert.ok(entry.lat >= 25 && entry.lat <= 50,
      `${portNumber} (${entry.name}): lat ${entry.lat} outside plausible US border-crossing range`);
    assert.ok(entry.lon >= -125 && entry.lon <= -66,
      `${portNumber} (${entry.name}): lon ${entry.lon} outside plausible US border-crossing range`);
  }
});

test('config/cbp_port_locations.json: keys are 6-character port numbers', () => {
  const parsed = JSON.parse(fs.readFileSync(LOCATIONS_PATH, 'utf8'));
  for (const portNumber of Object.keys(parsed)) {
    assert.equal(portNumber.length, 6, `port number "${portNumber}" is not 6 characters`);
  }
});

// ── Lifecycle coverage (mocked fetch) ────────────────────────────────────────

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

function crossingsPayload(overrides) {
  return {
    crossings: [
      { id: '070801', name: 'Alexandria Bay', border: 'Canadian Border', lat: 44.339, lon: -75.918, waitMinutes: 10, status: 'Open' },
      { id: '250401', name: 'San Ysidro', border: 'Mexican Border', lat: 32.5437, lon: -117.0304, waitMinutes: 45, status: 'Open' },
      { id: '380001', name: 'Detroit — Ambassador Bridge', border: 'Canadian Border', lat: 42.3124, lon: -83.0743, waitMinutes: null, status: 'Open' },
      ...(overrides || []),
    ],
    retrievedAt: Date.now(),
  };
}

test('crossing wait-time color bands: long wait is red, moderate is yellow, no report is gray', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => crossingsPayload() });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);

    const entities = viewer._dataSources[0].entities.values;
    assert.equal(entities.length, 3);
    const byId = Object.fromEntries(entities.map((e) => [e.id, e]));
    const now = Cesium.JulianDate.now();

    assert.ok(byId['border-wait-times:070801'].point.color.getValue(now).equals(Cesium.Color.LIME),
      'a short wait must render lime/green');
    assert.ok(byId['border-wait-times:250401'].point.color.getValue(now).equals(Cesium.Color.YELLOW),
      'a 20-60 min wait must render yellow');
    assert.ok(byId['border-wait-times:380001'].point.color.getValue(now).equals(Cesium.Color.GRAY),
      'a crossing with no reported wait must render gray, not "no wait" green');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('crossing wait-time color bands: long (>=60 min) wait is red', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      crossings: [{ id: '250401', name: 'San Ysidro', border: 'Mexican Border', lat: 32.5437, lon: -117.0304, waitMinutes: 75, status: 'Open' }],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);
    const [entity] = viewer._dataSources[0].entities.values;
    const now = Cesium.JulianDate.now();
    assert.ok(entity.point.color.getValue(now).equals(Cesium.Color.RED));
    assert.equal(entity.label.text.getValue(now), '75 min');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('crossing wait-time color bands: the 20 and 60 minute boundaries are exact', async () => {
  // The doc comment above waitStyle used to say "Moderate (20-60 min)" /
  // "Long (>= 60 min)" — an overlapping, ambiguous claim at exactly 60. The
  // code (>= comparisons) is right; this pins the real contract at both
  // boundaries so the comment can never silently drift from the code again.
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  const waitMinutesFor = async (waitMinutes) => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        crossings: [{ id: '250401', name: 'San Ysidro', border: 'Mexican Border', lat: 32.5437, lon: -117.0304, waitMinutes, status: 'Open' }],
      }),
    });
    await layer.update(viewer);
    const [entity] = viewer._dataSources[0].entities.values;
    return entity.point.color.getValue(Cesium.JulianDate.now());
  };
  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.ok((await waitMinutesFor(19)).equals(Cesium.Color.LIME), '19 min is still short/green');
    assert.ok((await waitMinutesFor(20)).equals(Cesium.Color.YELLOW), '20 min crosses into moderate/yellow');
    assert.ok((await waitMinutesFor(59)).equals(Cesium.Color.YELLOW), '59 min is still moderate/yellow');
    assert.ok((await waitMinutesFor(60)).equals(Cesium.Color.RED), '60 min crosses into long/red');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('a Closed crossing renders a distinct color regardless of wait minutes', async () => {
  // The bug: a crossing with status "Closed" but a short/no reported wait
  // used to get its color from waitMinutes alone, so it could render GREEN —
  // "open and fast" — while its label said Closed. Color, not the label, is
  // what actually reads at globe zoom.
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      crossings: [{ id: '250401', name: 'San Ysidro', border: 'Mexican Border', lat: 32.5437, lon: -117.0304, waitMinutes: 5, status: 'Closed' }],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    await layer.update(viewer);
    const [entity] = viewer._dataSources[0].entities.values;
    const color = entity.point.color.getValue(Cesium.JulianDate.now());
    assert.ok(!color.equals(Cesium.Color.LIME), 'a closed crossing must never read as green/fast');
    assert.ok(!color.equals(Cesium.Color.GRAY), 'closed is a distinct reading from "no report"');
    assert.equal(entity.label.text.getValue(Cesium.JulianDate.now()), 'Closed');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('a repeated port_number in the same payload is skipped, not a crash', async () => {
  // EntityCollection.add throws synchronously on a duplicate id; this used
  // to surface as a generic "Border wait times network error" (caught by
  // update()'s broad catch) instead of the actual data-quality problem, and
  // left the layer showing stale data from the PREVIOUS successful refresh.
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      crossings: [
        { id: '250401', name: 'San Ysidro', border: 'Mexican Border', lat: 32.5437, lon: -117.0304, waitMinutes: 10, status: 'Open' },
        { id: '250401', name: 'San Ysidro (dup)', border: 'Mexican Border', lat: 32.5437, lon: -117.0304, waitMinutes: 99, status: 'Open' },
      ],
    }),
  });
  try {
    layer.init(viewer);
    layer.enable(viewer);
    assert.equal(await layer.update(viewer), true, 'a duplicate id must not fail the whole refresh');
    assert.equal(layer.getStats().error, null);
    assert.equal(viewer._dataSources[0].entities.values.length, 1, 'only the first of the two duplicates is rendered');
    assert.equal(layer.getStats().count, 1);
    assert.equal(layer.getStats().duplicatesSkipped, 1);
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('real border wait times lifecycle: init/enable/update/disable/destroy', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  globalThis.fetch = async () => ({ ok: true, json: async () => crossingsPayload() });
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
    assert.ok(entity.point, 'crossings render as points');
    assert.ok(entity.label, 'crossings carry a wait-minutes label');

    const records = layer.getAnalystRecords();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.id).sort(), ['070801', '250401', '380001']);

    layer.disable(viewer);
    assert.equal(viewer._dataSources[0].show, false);
    assert.deepEqual(layer.getAnalystRecords(), [], 'disabled layer reports no records');

    layer.destroy(viewer);
    assert.equal(viewer._dataSources.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('border wait times refresh reports failure and clears it only after a successful response', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Border Wait Times HTTP 503');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ crossings: [] }) });
    assert.equal(await layer.update(viewer), true);
    assert.equal(layer.getStats().error, null);
    assert.ok(Number.isFinite(layer.getStats().lastUpdate));
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});

test('border wait times refresh rejects a malformed payload without throwing', async () => {
  const originalFetch = globalThis.fetch;
  const viewer = makeViewer();
  const layer = createBorderWaitTimesLayer();
  try {
    layer.init(viewer);
    layer.enable(viewer);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ notCrossings: [] }) });
    assert.equal(await layer.update(viewer), false);
    assert.equal(layer.getStats().error, 'Malformed border wait times response');
  } finally {
    globalThis.fetch = originalFetch;
    layer.destroy(viewer);
  }
});
