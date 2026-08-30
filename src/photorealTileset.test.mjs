// The photoreal acquisition chain. This exists because a missing or refused
// basemap used to take the whole app down: main.js hard-threw with no Google
// key (#64), and EEA-billed accounts get a 401 from the Map Tiles API even
// with a valid key (#59). The rule pinned throughout is that running out of
// sources degrades to a lesser globe, never to nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTOREAL_ION_ASSET_ID,
  planPhotorealSources,
  loadPhotorealTileset,
  describePhotorealOutcome,
  photorealUnavailableReason,
} from './photorealTileset.js';

const ok = (name) => async () => ({ tileset: name });
const boom = (message) => async () => { throw new Error(message); };

test('the ion asset id is the published Google 3D Tiles mirror', () => {
  assert.equal(PHOTOREAL_ION_ASSET_ID, 2275207);
});

test('google is attempted before ion — same imagery, one less intermediary', () => {
  const plan = planPhotorealSources({ googleApiKey: 'k', cesiumIonToken: 't' });
  assert.deepEqual(plan.map((s) => s.id), ['google', 'ion']);
  assert.ok(plan.every((s) => s.eligible));
});

test('a source with no credential is ineligible WITH A REASON, not silently dropped', () => {
  // The reason is what lets the loader line say which knob would have helped.
  const plan = planPhotorealSources({});
  assert.equal(plan[0].eligible, false);
  assert.match(plan[0].reason, /GOOGLE_MAPS_API_KEY/);
  assert.equal(plan[1].eligible, false);
  assert.match(plan[1].reason, /CESIUM_ION_TOKEN/);
});

test('whitespace is not a credential', () => {
  const plan = planPhotorealSources({ googleApiKey: '   ', cesiumIonToken: '\t' });
  assert.ok(plan.every((s) => !s.eligible));
});

test('the happy path loads Google directly and never reaches ion', async () => {
  let ionCalled = false;
  const outcome = await loadPhotorealTileset({
    googleApiKey: 'k',
    cesiumIonToken: 't',
    loaders: { google: ok('google'), ion: async () => { ionCalled = true; return { tileset: 'ion' }; } },
  });
  assert.equal(outcome.sourceId, 'google');
  assert.deepEqual(outcome.tileset, { tileset: 'google' });
  assert.equal(ionCalled, false, 'the preferred source short-circuits the chain');
});

test('#59: a 401 from the Map Tiles API falls through to the ion mirror', async () => {
  // The EEA case. A valid key, live billing, and the direct API still refuses.
  const outcome = await loadPhotorealTileset({
    googleApiKey: 'k',
    cesiumIonToken: 't',
    loaders: { google: boom('Request failed with status code 401'), ion: ok('ion') },
  });
  assert.equal(outcome.sourceId, 'ion');
  assert.deepEqual(outcome.tileset, { tileset: 'ion' });
  const google = outcome.attempts.find((a) => a.id === 'google');
  assert.equal(google.status, 'failed');
  assert.match(google.detail, /401/, 'the refusal is recorded, not swallowed');
});

test('#64: no Google key at all still reaches photoreal when ion is configured', async () => {
  const outcome = await loadPhotorealTileset({
    cesiumIonToken: 't',
    loaders: { google: boom('should not run'), ion: ok('ion') },
  });
  assert.equal(outcome.sourceId, 'ion');
  assert.equal(outcome.attempts.find((a) => a.id === 'google').status, 'skipped');
});

test('#64: no credentials at all yields no tileset — and NO throw', async () => {
  // The whole point: the app must continue to the keyless globe.
  const outcome = await loadPhotorealTileset({ loaders: {} });
  assert.equal(outcome.tileset, null);
  assert.equal(outcome.sourceId, null);
  assert.deepEqual(outcome.attempts.map((a) => a.status), ['skipped', 'skipped']);
});

test('every source failing yields no tileset rather than propagating an error', async () => {
  const outcome = await loadPhotorealTileset({
    googleApiKey: 'k',
    cesiumIonToken: 't',
    loaders: { google: boom('google down'), ion: boom('ion down') },
  });
  assert.equal(outcome.tileset, null);
  assert.deepEqual(outcome.attempts.map((a) => a.status), ['failed', 'failed']);
});

test('a loader returning nothing counts as a failure, not a success', async () => {
  const outcome = await loadPhotorealTileset({
    googleApiKey: 'k',
    cesiumIonToken: 't',
    loaders: { google: async () => null, ion: ok('ion') },
  });
  assert.equal(outcome.sourceId, 'ion');
  assert.match(outcome.attempts[0].detail, /no tileset/);
});

test('an eligible source with no loader is skipped rather than crashing', async () => {
  const outcome = await loadPhotorealTileset({
    googleApiKey: 'k',
    cesiumIonToken: 't',
    loaders: { ion: ok('ion') },
  });
  assert.equal(outcome.sourceId, 'ion');
  assert.equal(outcome.attempts[0].status, 'skipped');
});

test('onAttempt reports only the sources actually tried', async () => {
  const seen = [];
  await loadPhotorealTileset({
    cesiumIonToken: 't',
    loaders: { ion: ok('ion') },
    onAttempt: (source) => seen.push(source.id),
  });
  assert.deepEqual(seen, ['ion'], 'a source with no credential is never attempted');
});

test('DESCRIBES THE DIFFERENCE between a refused key and an absent one', () => {
  // These are not the same event and must not read the same. One is a choice;
  // the other is a problem the operator needs told about.
  const refused = describePhotorealOutcome({
    sourceId: 'ion',
    attempts: [{ id: 'google', status: 'failed', detail: 'g: 401' }, { id: 'ion', status: 'loaded' }],
  });
  assert.match(refused, /Cesium ion/);
  assert.match(refused, /refused/, 'a rejected key is called out');

  const absent = describePhotorealOutcome({
    sourceId: 'ion',
    attempts: [{ id: 'google', status: 'skipped', detail: 'no key' }, { id: 'ion', status: 'loaded' }],
  });
  assert.match(absent, /Cesium ion/);
  assert.doesNotMatch(absent, /refused/, 'never configuring a key is not a refusal');
});

test('the direct path describes itself plainly', () => {
  assert.equal(
    describePhotorealOutcome({ sourceId: 'google', attempts: [{ id: 'google', status: 'loaded' }] }),
    'Google Photorealistic 3D Tiles',
  );
});

test('with nothing configured the description names the keyless globe', () => {
  const text = describePhotorealOutcome({
    sourceId: null,
    attempts: [{ id: 'google', status: 'skipped' }, { id: 'ion', status: 'skipped' }],
  });
  assert.match(text, /keyless OSM globe/);
  assert.match(text, /No Google Maps key or Cesium ion token/);
});

test('with everything failing the description carries the failures', () => {
  const text = describePhotorealOutcome({
    sourceId: null,
    attempts: [
      { id: 'google', status: 'failed', detail: 'Google: 401' },
      { id: 'ion', status: 'failed', detail: 'ion: 403' },
    ],
  });
  assert.match(text, /401/);
  assert.match(text, /403/);
  assert.match(text, /keyless OSM globe/);
});

test('the tray reason distinguishes unconfigured from failed', () => {
  assert.equal(photorealUnavailableReason({ tileset: {} }), null, 'available needs no reason');

  const unconfigured = photorealUnavailableReason({
    tileset: null,
    attempts: [{ id: 'google', status: 'skipped' }, { id: 'ion', status: 'skipped' }],
  });
  assert.match(unconfigured, /Google Maps key/);
  assert.match(unconfigured, /Cesium ion token/, 'both routes are named');

  const failed = photorealUnavailableReason({
    tileset: null,
    attempts: [{ id: 'google', status: 'failed', detail: 'Google: 401' }],
  });
  assert.match(failed, /failed to load/);
  assert.match(failed, /401/);
});
