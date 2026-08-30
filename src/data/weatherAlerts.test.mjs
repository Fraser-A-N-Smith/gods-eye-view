// NWS alerts and NHC cyclone layers. The alert status line must never round
// away zone-only warnings, and the cyclone layer must never present an
// advisory fix as a live position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertsStatusText, createWeatherAlertsLayer } from './weatherAlerts.js';
import { cyclonesStatusText, cyclonePixelSize, createTropicalCyclonesLayer } from './tropicalCyclones.js';

test('ALERTS: zone-only warnings are surfaced in the status, never rounded away', () => {
  const text = alertsStatusText({ count: 120, drawable: 44, zoneOnly: 76 });
  assert.match(text, /120 ACTIVE/);
  assert.match(text, /44 DRAWN · 76 ZONE-ONLY/, 'the map shows fewer shapes than there are warnings');
});

test('ALERTS: with everything drawable there is no confusing second count', () => {
  const text = alertsStatusText({ count: 12, drawable: 12, zoneOnly: 0 });
  assert.doesNotMatch(text, /ZONE-ONLY/);
  assert.match(text, /12 ACTIVE/);
});

test('ALERTS: coverage is always named so a blank map is not read as calm', () => {
  assert.match(alertsStatusText({ count: 3, drawable: 3, zoneOnly: 0 }), /US COVERAGE/);
  assert.match(alertsStatusText({ count: 0 }), /US COVERAGE/);
});

test('ALERTS: an empty result says no ACTIVE ALERTS, scoped to coverage', () => {
  assert.equal(alertsStatusText({ count: 0 }), 'NO ACTIVE ALERTS · US COVERAGE');
});

test('ALERTS: truncation reports the real total', () => {
  const text = alertsStatusText({ count: 500, drawable: 500, zoneOnly: 0, truncated: true, total: 913 });
  assert.match(text, /OF 913 — MOST SEVERE SHOWN/);
});

test('ALERTS: errors and loading take priority', () => {
  assert.equal(alertsStatusText({ count: 5, error: 'ALERT FEED UNAVAILABLE' }), 'ALERT FEED UNAVAILABLE');
  assert.equal(alertsStatusText({ loading: true }), 'LOADING ALERTS');
});

test('ALERTS: zone-only alerts are listable so a UI can show what the map omits', async () => {
  const layer = createWeatherAlertsLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        alerts: [
          { id: '1', event: 'Flood Warning', severity: 'Severe', drawable: true, rings: [] },
          { id: '2', event: 'Tornado Warning', severity: 'Extreme', drawable: false, rings: [], areaDesc: 'Ellis County' },
        ],
        drawable: 1,
        zoneOnly: 1,
        total: 2,
      }),
    }),
  });
  layer.enable();
  await layer.update();
  const omitted = layer.getZoneOnlyAlerts();
  assert.equal(omitted.length, 1);
  assert.equal(omitted[0].event, 'Tornado Warning');
  assert.equal(omitted[0].areaDesc, 'Ellis County');
});

test('ALERTS: a disabled layer does not poll', async () => {
  let fetched = 0;
  const layer = createWeatherAlertsLayer({
    fetchImpl: async () => { fetched += 1; return { ok: true, json: async () => ({ alerts: [] }) }; },
  });
  await layer.update();
  assert.equal(fetched, 0);
});

test('ALERTS: HTTP, malformed and network failures degrade honestly', async () => {
  const http = createWeatherAlertsLayer({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  http.enable();
  assert.equal(await http.update(), false);
  assert.match(http.getStats().error, /HTTP 503/);

  const malformed = createWeatherAlertsLayer({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  malformed.enable();
  assert.equal(await malformed.update(), false);
  assert.match(malformed.getStats().error, /MALFORMED/);

  const offline = createWeatherAlertsLayer({ fetchImpl: async () => { throw new Error('offline'); } });
  offline.enable();
  assert.equal(await offline.update(), false);
  assert.match(offline.getStats().error, /UNAVAILABLE/);
});

test('CYCLONES: the status says advisory positions, not a live track', () => {
  // A hurricane marker is up to a few hours old; implying "now" would be wrong
  // in the direction that matters.
  const text = cyclonesStatusText({ count: 2, strongest: 'CAT 3' });
  assert.match(text, /ADVISORY POSITIONS, NOT LIVE TRACK/);
  assert.match(text, /STRONGEST CAT 3/);
});

test('CYCLONES: an empty basin says no active cyclones, scoped to NHC', () => {
  assert.equal(cyclonesStatusText({ count: 0 }), 'NO ACTIVE CYCLONES · NHC BASINS');
});

test('CYCLONES: marker size grows with category and unknown gets a floor', () => {
  assert.ok(cyclonePixelSize(5) > cyclonePixelSize(1));
  assert.equal(cyclonePixelSize(-1), 10, 'an unknown intensity still renders');
  assert.equal(cyclonePixelSize(NaN), 10);
});

test('CYCLONES: analyst records mark the fix as an advisory, not an observation', async () => {
  const layer = createTropicalCyclonesLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        storms: [{ id: 'al05', name: 'FIONA', lat: 24, lon: -71, windKt: 105, pressureMb: 948 }],
      }),
    }),
  });
  layer.enable();
  await layer.update();
  const [record] = layer.getAnalystRecords();
  assert.equal(record.kind, 'cyclone-advisory-fix');
  assert.equal(record.category, 'CAT 3');
  assert.equal(layer.getStats().count, 1);
});

test('CYCLONES: failures degrade honestly', async () => {
  const offline = createTropicalCyclonesLayer({ fetchImpl: async () => { throw new Error('offline'); } });
  offline.enable();
  assert.equal(await offline.update(), false);
  assert.match(offline.getStats().error, /UNAVAILABLE/);
});
