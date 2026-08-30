// Vessel events layer. The hedge must survive into the status line, a missing
// key must read as KEY REQUIRED rather than as a failure, and a theme switch
// must not paint stale events under a new label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vesselEventsStatusText, createVesselEventsLayer } from './vesselEvents.js';
import { DEFAULT_VESSEL_EVENT_PRESET_ID } from './vesselEventsShape.js';

test('THE HEDGE REACHES THE STATUS LINE, not just a tooltip', () => {
  const text = vesselEventsStatusText({ presetId: 'gaps', count: 40, windowDays: 14 });
  assert.match(text, /AIS GAPS · 40/);
  assert.match(text, /APPARENT AIS DISABLING/);
  assert.match(text, /COVERAGE HOLE/, 'the innocent explanation is named too');
});

test('the observation window is always stated', () => {
  assert.match(vesselEventsStatusText({ presetId: 'gaps', count: 3, windowDays: 14 }), /14D WINDOW/);
});

test('KEY REQUIRED is a configured state, not an error', () => {
  const text = vesselEventsStatusText({ keyMissing: true, presetId: 'gaps' });
  assert.match(text, /KEY REQUIRED/);
  assert.match(text, /UNAVAILABLE/);
});

test('an empty result is scoped to the window, not declared as "no gaps exist"', () => {
  assert.match(vesselEventsStatusText({ presetId: 'gaps', count: 0 }), /NONE IN WINDOW/);
});

test('truncation reports the real total', () => {
  const text = vesselEventsStatusText({ presetId: 'gaps', count: 600, truncated: true, total: 9100, windowDays: 14 });
  assert.match(text, /OF 9100 — LONGEST SHOWN/);
});

test('a missing key beats an error in the status precedence', () => {
  const text = vesselEventsStatusText({ keyMissing: true, error: 'SOMETHING ELSE' });
  assert.match(text, /KEY REQUIRED/);
});

test('setPreset refuses anything outside the allowlist', () => {
  const layer = createVesselEventsLayer();
  assert.equal(layer.setPreset('public-global-gaps-events:latest'), false);
  assert.equal(layer.setPreset('nope'), false);
  assert.equal(layer.setPreset(null), false);
  assert.equal(layer.getPresets().find((p) => p.active).id, DEFAULT_VESSEL_EVENT_PRESET_ID);
});

test('the default event type is AIS gaps — the reason the layer exists', () => {
  assert.equal(DEFAULT_VESSEL_EVENT_PRESET_ID, 'gaps');
});

test('a 503 is treated as KEY REQUIRED and does not fail the refresh', async () => {
  // A declared missing optional key is a terminal configured state; reporting
  // it as a failure would turn a keyless install into a red layer.
  const layer = createVesselEventsLayer({ fetchImpl: async () => ({ status: 503, ok: false }) });
  layer.enable();
  assert.equal(await layer.update(), true, 'not a failure');
  const stats = layer.getStats();
  assert.equal(stats.unavailable, true);
  assert.equal(stats.error, null, 'no error is raised for a deliberate keyless install');
  assert.match(stats.status, /KEY REQUIRED/);
});

test('a real HTTP failure is still an error', async () => {
  const layer = createVesselEventsLayer({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /HTTP 500/);
});

test('a response for a superseded event type is discarded', async () => {
  const layer = createVesselEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ preset: 'encounters', events: [{ id: 'e', lat: 1, lon: 1 }] }),
    }),
  });
  layer.enable();
  layer.setPreset('loitering');
  await layer.update();
  assert.equal(layer.getStats().count, 0, 'events must not be relabelled by a later switch');
});

test('analyst records mark events as apparent, not observed', async () => {
  const layer = createVesselEventsLayer({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        preset: DEFAULT_VESSEL_EVENT_PRESET_ID,
        events: [{ id: 'e1', lat: -12, lon: 145, vessel: 'FV EXAMPLE', flag: 'PAN', durationHours: 30, type: 'gaps' }],
        total: 1,
      }),
    }),
  });
  layer.enable();
  await layer.update();
  const [record] = layer.getAnalystRecords();
  assert.equal(record.kind, 'apparent-vessel-event');
  assert.equal(record.vessel, 'FV EXAMPLE');
  assert.equal(record.durationHours, 30);
});

test('a disabled layer does not poll', async () => {
  let fetched = 0;
  const layer = createVesselEventsLayer({
    fetchImpl: async () => { fetched += 1; return { ok: true, status: 200, json: async () => ({ events: [] }) }; },
  });
  await layer.update();
  assert.equal(fetched, 0);
});
