// ACLED events layer. The hedge must survive into the status line, a missing
// key must read as KEY REQUIRED rather than as a failure, and a theme switch
// must not paint stale events under a new label — same discipline as the GFW
// vessel-events layer this one is templated on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acledEventsStatusText, createAcledEventsLayer } from './acledEvents.js';
import { DEFAULT_ACLED_PRESET_ID, ACLED_PRESET_IDS } from './acledEventsShape.js';

test('THE HEDGE REACHES THE STATUS LINE, not just a tooltip', () => {
  const text = acledEventsStatusText({ presetId: 'battles', count: 12, windowDays: 30 });
  assert.match(text, /BATTLES · 12/);
  assert.match(text, /NOT INDEPENDENTLY VERIFIED/);
});

test('the observation window is always stated', () => {
  assert.match(acledEventsStatusText({ presetId: 'riots', count: 3, windowDays: 30 }), /30D WINDOW/);
});

test('KEY REQUIRED is a configured state, not an error', () => {
  const text = acledEventsStatusText({ keyMissing: true, presetId: 'battles' });
  assert.match(text, /KEY REQUIRED/);
  assert.match(text, /UNAVAILABLE/);
});

test('a missing key beats an error in the status precedence', () => {
  const text = acledEventsStatusText({ keyMissing: true, error: 'SOMETHING ELSE' });
  assert.match(text, /KEY REQUIRED/);
});

test('an empty result is scoped to the window, not declared as "nothing happened"', () => {
  assert.match(acledEventsStatusText({ presetId: 'protests', count: 0 }), /NONE IN WINDOW/);
});

test('truncation reports the real total', () => {
  const text = acledEventsStatusText({
    presetId: 'battles', count: 600, truncated: true, total: 4200, windowDays: 30,
  });
  assert.match(text, /OF 4200 — MOST RECENT SHOWN/);
});

test('setPreset REFUSES anything outside the allowlist', () => {
  const layer = createAcledEventsLayer();
  assert.equal(layer.setPreset('Battles'), false, 'the raw ACLED event_type string is not a preset id');
  assert.equal(layer.setPreset('nope'), false);
  assert.equal(layer.setPreset(null), false);
  assert.equal(layer.getPresets().find((p) => p.active).id, DEFAULT_ACLED_PRESET_ID);
});

test('the default event type is battles', () => {
  assert.equal(DEFAULT_ACLED_PRESET_ID, 'battles');
});

test('getParams/setParams round-trip the preset (the enabled+options contract)', () => {
  const layer = createAcledEventsLayer();
  assert.deepEqual(layer.getParams(), { preset: DEFAULT_ACLED_PRESET_ID });
  assert.equal(layer.setParams({ preset: 'protests' }), true);
  assert.deepEqual(layer.getParams(), { preset: 'protests' });
  assert.equal(layer.setParams({ preset: 'not-a-preset' }), false);
  assert.deepEqual(layer.getParams(), { preset: 'protests' }, 'unchanged after a refused write');
});

test('getRowControls exposes a working chip per event type', () => {
  const layer = createAcledEventsLayer();
  const controls = layer.getRowControls();
  assert.equal(controls.chips.length, ACLED_PRESET_IDS.length);
  assert.equal(controls.chips.filter((c) => c.active).length, 1);
});

test('a 503 is treated as KEY REQUIRED and does not fail the refresh', async () => {
  const layer = createAcledEventsLayer({ fetchImpl: async () => ({ status: 503, ok: false }) });
  layer.enable();
  assert.equal(await layer.update(), true, 'not a failure');
  const stats = layer.getStats();
  assert.equal(stats.unavailable, true);
  assert.equal(stats.error, null, 'no error is raised for a deliberate keyless install');
  assert.match(stats.status, /KEY REQUIRED/);
});

test('a real HTTP failure is still an error', async () => {
  const layer = createAcledEventsLayer({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /HTTP 500/);
});

test('a malformed body is reported as malformed, not as an empty world', async () => {
  const layer = createAcledEventsLayer({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
  });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /MALFORMED/);
});

test('a response for a superseded event type is discarded', async () => {
  const layer = createAcledEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ preset: 'riots', events: [{ id: 'e', lat: 1, lon: 1 }] }),
    }),
  });
  layer.enable();
  layer.setPreset('protests');
  await layer.update();
  assert.equal(layer.getStats().count, 0, 'events must not be relabelled by a later switch');
});

test('analyst records mark events as sourced reports, not verified sightings', async () => {
  const layer = createAcledEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        preset: DEFAULT_ACLED_PRESET_ID,
        events: [{ id: 'x1', lat: -12, lon: 145, type: 'battles', precision: 'exact', fatalities: 4, country: 'Testland' }],
        total: 1,
      }),
    }),
  });
  layer.enable();
  await layer.update();
  const [record] = layer.getAnalystRecords();
  assert.equal(record.kind, 'sourced-conflict-event');
  assert.equal(record.precision, 'exact');
  assert.equal(record.country, 'Testland');
});

test('a disabled layer does not poll', async () => {
  let fetched = 0;
  const layer = createAcledEventsLayer({
    fetchImpl: async () => { fetched += 1; return { ok: true, status: 200, json: async () => ({ events: [] }) }; },
  });
  await layer.update();
  assert.equal(fetched, 0);
  assert.deepEqual(layer.getAnalystRecords(), []);
});

test('a network throw degrades to an unavailable status, distinct from KEY REQUIRED', async () => {
  const layer = createAcledEventsLayer({ fetchImpl: async () => { throw new Error('offline'); } });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /UNAVAILABLE/);
  assert.equal(layer.getStats().unavailable, false, 'a network failure is not the same state as no key');
});
