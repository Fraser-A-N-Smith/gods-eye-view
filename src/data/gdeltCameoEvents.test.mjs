// GDELT Event 2.0 CAMEO layer behaviour. Load-bearing: reported events are
// never presented as confirmed, a warming buffer reads as warming (not
// empty), a theme switch must not paint stale records under a new label, and
// the chip row / setParams contract that makes the preset switcher actually
// work in the UI (unlike the mentions layer's dead getPresets()/setPreset()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gdeltCameoStatusText, createGdeltCameoEventsLayer } from './gdeltCameoEvents.js';
import { DEFAULT_CAMEO_PRESET_ID, CAMEO_PRESET_IDS } from './gdeltCameoEventsShape.js';

test('STATUS: reported events are never presented as confirmed', () => {
  const text = gdeltCameoStatusText({ presetId: 'conflict', count: 12 });
  assert.match(text, /12 REPORTED EVENTS/);
  assert.match(text, /NOT CONFIRMED INCIDENTS/);
  assert.doesNotMatch(text, /\b12 EVENTS\b/);
});

test('STATUS: a warming buffer reads as warming, not empty', () => {
  const text = gdeltCameoStatusText({ presetId: 'unrest', count: 0, warming: true });
  assert.match(text, /BUFFER WARMING UP/);
  assert.doesNotMatch(text, /NO REPORTED EVENTS/);
});

test('STATUS: an empty settled buffer says so distinctly from warming', () => {
  const text = gdeltCameoStatusText({ presetId: 'diplomacy', count: 0, warming: false });
  assert.match(text, /NO REPORTED EVENTS IN BUFFER/);
});

test('STATUS: truncation reports the real matched total', () => {
  const text = gdeltCameoStatusText({ presetId: 'conflict', count: 750, truncated: true, totalFeatures: 2000 });
  assert.match(text, /OF 2000 — MOST-REPORTED SHOWN/);
});

test('STATUS: errors and loading take priority over the count', () => {
  assert.equal(gdeltCameoStatusText({ count: 9, error: 'GDELT CAMEO FEED UNAVAILABLE' }), 'GDELT CAMEO FEED UNAVAILABLE');
  assert.equal(gdeltCameoStatusText({ count: 0, loading: true }), 'LOADING GEOPOLITICAL EVENTS');
});

test('the layer starts on the default theme and exposes all three presets', () => {
  const layer = createGdeltCameoEventsLayer();
  const presets = layer.getPresets();
  assert.equal(presets.length, CAMEO_PRESET_IDS.length);
  const active = presets.filter((p) => p.active);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, DEFAULT_CAMEO_PRESET_ID);
});

test('setPreset REFUSES anything outside the allowlist', () => {
  const layer = createGdeltCameoEventsLayer();
  assert.equal(layer.setPreset('theme:PROTEST'), false);
  assert.equal(layer.setPreset(''), false);
  assert.equal(layer.setPreset(null), false);
  assert.equal(layer.getPresets().find((p) => p.active).id, DEFAULT_CAMEO_PRESET_ID);
});

test('setPreset switches theme and reports no-op for the current one', () => {
  const layer = createGdeltCameoEventsLayer();
  assert.equal(layer.setPreset('conflict'), true);
  assert.equal(layer.getPresets().find((p) => p.active).id, 'conflict');
  assert.equal(layer.setPreset('conflict'), false);
});

test('getParams/setParams round-trip the preset (the enabled+options contract)', () => {
  const layer = createGdeltCameoEventsLayer();
  assert.deepEqual(layer.getParams(), { preset: DEFAULT_CAMEO_PRESET_ID });
  assert.equal(layer.setParams({ preset: 'diplomacy' }), true);
  assert.deepEqual(layer.getParams(), { preset: 'diplomacy' });
  assert.equal(layer.setParams({ preset: 'not-a-preset' }), false, 'invalid values are refused, not ignored');
  assert.deepEqual(layer.getParams(), { preset: 'diplomacy' }, 'unchanged after a refused write');
  assert.equal(layer.setParams({}), true, 'an empty patch is a no-op success, not a refusal');
});

test('getRowControls exposes a working chip per preset, unlike the mentions layer', () => {
  const layer = createGdeltCameoEventsLayer();
  const controls = layer.getRowControls();
  assert.equal(controls.chips.length, CAMEO_PRESET_IDS.length);
  const active = controls.chips.filter((c) => c.active);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, DEFAULT_CAMEO_PRESET_ID);
  for (const chip of controls.chips) assert.deepEqual(chip.params, { preset: chip.id });
});

test('a response for a superseded theme is discarded, not drawn under the new label', () => {
  const layer = createGdeltCameoEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ preset: 'conflict', records: [{ id: 'a', lon: 1, lat: 1, numMentions: 5 }] }),
    }),
  });
  layer.enable();
  layer.setPreset('unrest');
  return layer.update().then(() => {
    assert.equal(layer.getStats().count, 0);
  });
});

test('a disabled layer neither fetches nor reports records', async () => {
  let fetched = 0;
  const layer = createGdeltCameoEventsLayer({
    fetchImpl: async () => { fetched += 1; return { ok: true, json: async () => ({ records: [] }) }; },
  });
  await layer.update();
  assert.equal(fetched, 0);
  assert.deepEqual(layer.getAnalystRecords(), []);
});

test('an HTTP failure is reported and does not throw', async () => {
  const layer = createGdeltCameoEventsLayer({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /GDELT CAMEO FEED HTTP 503/);
});

test('a malformed body is reported as malformed, not as an empty world', async () => {
  const layer = createGdeltCameoEventsLayer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ nope: true }) }),
  });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /MALFORMED/);
});

test('a network throw degrades to an unavailable status', async () => {
  const layer = createGdeltCameoEventsLayer({ fetchImpl: async () => { throw new Error('offline'); } });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /UNAVAILABLE/);
});

test('a warming payload surfaces through getStats without being treated as an error', async () => {
  const layer = createGdeltCameoEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ preset: DEFAULT_CAMEO_PRESET_ID, records: [], warming: true }),
    }),
  });
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().warming, true);
  assert.equal(layer.getStats().error, null);
});

test('analyst records are marked as reported events, not confirmed incidents', async () => {
  const layer = createGdeltCameoEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        preset: DEFAULT_CAMEO_PRESET_ID,
        records: [{ id: 'x', lon: -0.37, lat: 39.47, numMentions: 12, rootCode: '14', precision: 'locality', goldstein: -4 }],
      }),
    }),
  });
  layer.enable();
  await layer.update();
  const [record] = layer.getAnalystRecords();
  assert.equal(record.kind, 'reported-event');
  assert.equal(record.precision, 'locality');
  assert.equal(record.theme, DEFAULT_CAMEO_PRESET_ID);
});
