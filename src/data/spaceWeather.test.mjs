// Space weather layer. The status line is the product here: it must always say
// the oval is a FORECAST, must never render a missing index as quiet, and must
// carry the operational consequence rather than a bare number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spaceWeatherStatusText, createSpaceWeatherLayer } from './spaceWeather.js';

test('ALWAYS FORECAST: the status never presents the oval as an observation', () => {
  for (const state of [
    { kp: 2, count: 500 },
    { kp: null, count: 500 },
    { kp: 8, count: 1 },
  ]) {
    assert.match(spaceWeatherStatusText(state), /FORECAST/, JSON.stringify(state));
  }
});

test('the status carries the operational effect, not just the index', () => {
  const text = spaceWeatherStatusText({ kp: 7, count: 900 });
  assert.match(text, /KP 7\.0/);
  assert.match(text, /G3 STORM/);
  // "Kp 7" alone is not actionable; the consequence is the point of the layer.
  assert.match(text, /HF|GNSS|ORBIT/);
});

test('a missing index reads UNKNOWN, never quiet', () => {
  const text = spaceWeatherStatusText({ kp: null, count: 200 });
  assert.match(text, /KP UNKNOWN/);
  assert.doesNotMatch(text, /QUIET/);
});

test('an empty oval says there is no forecast, not that there is no aurora', () => {
  const text = spaceWeatherStatusText({ kp: 1, count: 0 });
  assert.match(text, /NO AURORA FORECAST/);
});

test('errors and loading take priority', () => {
  assert.equal(spaceWeatherStatusText({ error: 'SPACE WEATHER UNAVAILABLE' }), 'SPACE WEATHER UNAVAILABLE');
  assert.equal(spaceWeatherStatusText({ loading: true }), 'LOADING SPACE WEATHER');
});

test('getConditions always flags the forecast nature to its callers', () => {
  const layer = createSpaceWeatherLayer();
  const conditions = layer.getConditions();
  assert.equal(conditions.forecast, true, 'the HUD and voice must not be able to drop this');
  assert.equal(conditions.kp, null);
  assert.equal(conditions.label, 'UNKNOWN');
});

test('a disabled layer does not poll', async () => {
  let fetched = 0;
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => { fetched += 1; return { ok: true, json: async () => ({ aurora: [] }) }; },
  });
  await layer.update();
  assert.equal(fetched, 0);
});

test('a good response populates conditions and cells', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        aurora: [{ lon: 10, lat: 70, probability: 80 }, { lon: 11, lat: 70, probability: 40 }],
        auroraPeak: 80,
        kp: 6.33,
        kpAvailable: true,
        forecastAt: '2026-08-30T13:00:00Z',
      }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.equal(stats.count, 2);
  assert.ok(Math.abs(stats.kp - 6.33) < 1e-9);
  assert.match(stats.status, /G2 STORM/);
  assert.equal(layer.getConditions().forecastAt, '2026-08-30T13:00:00Z');
});

test('a missing Kp still draws the oval — the index is optional, the grid is not', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ aurora: [{ lon: 0, lat: 70, probability: 50 }], kpAvailable: false }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().count, 1);
  assert.match(layer.getStats().status, /KP UNKNOWN/);
});

test('solarEvents, closeApproaches and radioBlackoutScale are [] / [] / null when the proxy omits them', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ aurora: [], kpAvailable: false }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.deepEqual(stats.solarEvents, []);
  assert.deepEqual(stats.closeApproaches, []);
  assert.equal(stats.radioBlackoutScale, null);
  assert.notEqual(stats.solarEvents, undefined);
  assert.notEqual(stats.closeApproaches, undefined);
});

test('a merged payload carrying DONKI, NeoWs and NOAA-scales data surfaces all three on getStats()', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        aurora: [],
        kpAvailable: false,
        solarEvents: [
          { id: 'evt-1', type: 'CME', issuedMs: 1756540800000, summary: 'A CME left the sun.', url: 'https://example.test/evt-1' },
        ],
        closeApproaches: [
          { id: '222', name: '(2026 BB2)', missDistanceKm: 900000, velocityKmS: 30.1, diameterMinM: 100, diameterMaxM: 220, hazardous: true, closeApproachMs: 1756541000000 },
        ],
        radioBlackoutScale: { scale: '2', text: 'Moderate radio blackout' },
      }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.equal(stats.solarEvents.length, 1);
  assert.equal(stats.solarEvents[0].id, 'evt-1');
  assert.equal(stats.closeApproaches.length, 1);
  assert.equal(stats.closeApproaches[0].hazardous, true);
  assert.deepEqual(stats.radioBlackoutScale, { scale: '2', text: 'Moderate radio blackout' });
  // The aurora/Kp contract is unaffected by the presence of the panel fields.
  assert.equal(stats.count, 0);
  assert.match(stats.status, /KP UNKNOWN/);
});

test('a non-array solarEvents/closeApproaches or non-object radioBlackoutScale on the wire degrades to the safe default rather than propagating junk', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        aurora: [],
        kpAvailable: false,
        solarEvents: 'not-an-array',
        closeApproaches: null,
        radioBlackoutScale: 'not-an-object',
      }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.deepEqual(stats.solarEvents, []);
  assert.deepEqual(stats.closeApproaches, []);
  assert.equal(stats.radioBlackoutScale, null);
});

test('an array radioBlackoutScale on the wire is rejected too — typeof [] === "object" is not enough', async () => {
  // A bare typeof-object check would let an array through as if it were the
  // {scale, text} record; this pins the Array.isArray guard.
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ aurora: [], kpAvailable: false, radioBlackoutScale: ['2', 'Moderate'] }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().radioBlackoutScale, null);
});

test('impactRiskObjects and solarWindNow are [] / null when the proxy omits them', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ aurora: [], kpAvailable: false }) }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.deepEqual(stats.impactRiskObjects, []);
  assert.equal(stats.solarWindNow, null);
  assert.notEqual(stats.impactRiskObjects, undefined);
});

test('a merged payload carrying Sentry and solar-wind data surfaces both on getStats()', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        aurora: [],
        kpAvailable: false,
        impactRiskObjects: [
          { designation: '2023 TL4', fullname: '(2023 TL4)', diameterKm: 0.05, impactProbability: 0.11, palermoScale: -2.9, torinoScale: 0, velocityKmS: 9.1, lastObservedDate: '2023-11-01' },
        ],
        solarWindNow: { speedKmS: 402.7, density: 4.3, bz: -5.1, bt: 5.9, sampledAtMs: 1756540860000 },
      }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.equal(stats.impactRiskObjects.length, 1);
  assert.equal(stats.impactRiskObjects[0].designation, '2023 TL4');
  assert.deepEqual(stats.solarWindNow, { speedKmS: 402.7, density: 4.3, bz: -5.1, bt: 5.9, sampledAtMs: 1756540860000 });
  // The aurora/Kp contract is unaffected by the presence of the new panel fields.
  assert.equal(stats.count, 0);
});

test('a non-array impactRiskObjects or non-object solarWindNow on the wire degrades to the safe default', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        aurora: [], kpAvailable: false,
        impactRiskObjects: 'not-an-array',
        solarWindNow: 'not-an-object',
      }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const stats = layer.getStats();
  assert.deepEqual(stats.impactRiskObjects, []);
  assert.equal(stats.solarWindNow, null);
});

test('an array solarWindNow on the wire is rejected too — typeof [] === "object" is not enough', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ aurora: [], kpAvailable: false, solarWindNow: [1, 2, 3] }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().solarWindNow, null);
});

test('the DONKI/NeoWs/NOAA-scales enrichments reach getStats().loadingLabel — the field the toggle panel actually renders', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        aurora: [],
        kpAvailable: false,
        solarEvents: [{ id: 'evt-1', type: 'CME', issuedMs: 1, summary: 'x', url: null }],
        closeApproaches: [
          { id: '1', name: '(2026 BB2)', missDistanceKm: 384_400, velocityKmS: 1, diameterMinM: 1, diameterMaxM: 2, hazardous: false, closeApproachMs: 1 },
        ],
        radioBlackoutScale: { scale: '1', text: 'Minor' },
      }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  const { loadingLabel } = layer.getStats();
  assert.match(loadingLabel, /R1 BLACKOUT/);
  assert.match(loadingLabel, /1 SOLAR EVENT\b/);
  assert.match(loadingLabel, /NEO \(2026 BB2\) · 1\.0 LD/);
});

test('an empty enrichment leaves loadingLabel empty rather than a placeholder', async () => {
  const layer = createSpaceWeatherLayer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ aurora: [], kpAvailable: false }) }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().loadingLabel, '');
});

test('HTTP, malformed, and network failures each degrade honestly', async () => {
  const http = createSpaceWeatherLayer({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  http.enable();
  assert.equal(await http.update(), false);
  assert.match(http.getStats().error, /HTTP 500/);

  const malformed = createSpaceWeatherLayer({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  malformed.enable();
  assert.equal(await malformed.update(), false);
  assert.match(malformed.getStats().error, /MALFORMED/);

  const offline = createSpaceWeatherLayer({ fetchImpl: async () => { throw new Error('offline'); } });
  offline.enable();
  assert.equal(await offline.update(), false);
  assert.match(offline.getStats().error, /UNAVAILABLE/);
});
