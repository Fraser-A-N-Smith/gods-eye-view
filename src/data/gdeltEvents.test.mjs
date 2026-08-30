// GDELT layer behaviour. Everything pinned here is about not overclaiming:
// mentions are not events, an empty region is not a quiet one, and a theme
// switch must not paint stale records under a new label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gdeltStatusText, createGdeltEventsLayer } from './gdeltEvents.js';
import { DEFAULT_GDELT_PRESET_ID } from './gdeltEventsShape.js';

test('STATUS: the count is always framed as places mentioned, never events', () => {
  const text = gdeltStatusText({ presetId: 'unrest', count: 40 });
  assert.match(text, /40 PLACES MENTIONED/);
  assert.match(text, /NOT AN EVENT COUNT/);
  assert.doesNotMatch(text, /\b40 EVENTS\b/);
});

test('STATUS: an empty result says "no reporting", not "nothing happened"', () => {
  const text = gdeltStatusText({ presetId: 'conflict', count: 0 });
  assert.match(text, /NO REPORTING IN 24H/);
  assert.doesNotMatch(text, /NO CONFLICT/);
});

test('STATUS: the active theme is named, and coverage is always disclosed', () => {
  const text = gdeltStatusText({ presetId: 'disaster', count: 5 });
  assert.match(text, /^DISASTER/);
  assert.match(text, /24H MEDIA COVERAGE/);
});

test('STATUS: truncation reports the real upstream total', () => {
  const text = gdeltStatusText({ presetId: 'unrest', count: 750, truncated: true, totalFeatures: 4200 });
  assert.match(text, /OF 4200 — MOST-REPORTED SHOWN/);
});

test('STATUS: errors and loading take priority over the count', () => {
  assert.equal(gdeltStatusText({ count: 9, error: 'GDELT FEED UNAVAILABLE' }), 'GDELT FEED UNAVAILABLE');
  assert.equal(gdeltStatusText({ count: 0, loading: true }), 'LOADING REPORTING');
});

test('the layer starts on the default theme and exposes the preset list', () => {
  const layer = createGdeltEventsLayer();
  const presets = layer.getPresets();
  assert.ok(presets.length >= 3);
  const active = presets.filter((p) => p.active);
  assert.equal(active.length, 1, 'exactly one theme is active');
  assert.equal(active[0].id, DEFAULT_GDELT_PRESET_ID);
});

test('setPreset REFUSES anything outside the allowlist', () => {
  const layer = createGdeltEventsLayer();
  assert.equal(layer.setPreset('theme:PROTEST'), false, 'a raw query is not a preset id');
  assert.equal(layer.setPreset('Jane Doe'), false);
  assert.equal(layer.setPreset(''), false);
  assert.equal(layer.setPreset(null), false);
  assert.equal(layer.getPresets().find((p) => p.active).id, DEFAULT_GDELT_PRESET_ID, 'unchanged');
});

test('setPreset switches theme and reports no-op for the current one', () => {
  const layer = createGdeltEventsLayer();
  assert.equal(layer.setPreset('unrest'), true);
  assert.equal(layer.getPresets().find((p) => p.active).id, 'unrest');
  assert.equal(layer.setPreset('unrest'), false, 'switching to the active theme changes nothing');
});

test('a response for a superseded theme is discarded, not drawn under the new label', () => {
  // The user switches theme while a request is in flight. Painting the old
  // records under the new heading would mislabel every dot on screen.
  const layer = createGdeltEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        preset: 'conflict',
        records: [{ id: 'a', name: 'Somewhere', lon: 1, lat: 1, mentions: 5 }],
        maxMentions: 5,
      }),
    }),
  });
  layer.enable();
  layer.setPreset('unrest');
  return layer.update().then(() => {
    assert.equal(layer.getStats().count, 0, 'stale-theme records are dropped');
  });
});

test('a disabled layer neither fetches nor reports records', async () => {
  let fetched = 0;
  const layer = createGdeltEventsLayer({
    fetchImpl: async () => { fetched += 1; return { ok: true, json: async () => ({ records: [] }) }; },
  });
  await layer.update();
  assert.equal(fetched, 0, 'a layer that is off does not poll');
  assert.deepEqual(layer.getAnalystRecords(), []);
});

test('an HTTP failure is reported and does not throw', async () => {
  const layer = createGdeltEventsLayer({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /GDELT FEED HTTP 503/);
});

test('a malformed body is reported as malformed, not as an empty world', async () => {
  const layer = createGdeltEventsLayer({
    fetchImpl: async () => ({ ok: true, json: async () => ({ nope: true }) }),
  });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /MALFORMED/);
});

test('a network throw degrades to an unavailable status', async () => {
  const layer = createGdeltEventsLayer({
    fetchImpl: async () => { throw new Error('offline'); },
  });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /UNAVAILABLE/);
});

test('analyst records are marked as media mentions, not sightings', async () => {
  const layer = createGdeltEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        preset: DEFAULT_GDELT_PRESET_ID,
        records: [{ id: 'x', name: 'Valencia', lon: -0.37, lat: 39.47, mentions: 12, summary: 'Flooding' }],
        maxMentions: 12,
      }),
    }),
  });
  layer.enable();
  await layer.update();
  const [record] = layer.getAnalystRecords();
  assert.equal(record.kind, 'media-mention', 'a mention must not be queryable as an observed object');
  assert.equal(record.mentions, 12);
  assert.equal(record.theme, DEFAULT_GDELT_PRESET_ID);
});
