// RainViewer radar and IR satellite overlays. The behaviour this module exists
// to get right is the same-frame no-op: RainViewer publishes every ~10 minutes,
// most polls land between publications, and rebuilding live imagery for an
// identical frame throws away a warm tile cache and flickers for nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAINVIEWER_OVERLAYS,
  RAINVIEWER_OVERLAY_IDS,
  RAINVIEWER_POLL_MS,
  createRainviewerLayer,
  rainviewerStatusText,
  loadFrames,
  resetFrameCache,
} from './rainviewerOverlays.js';

const radar = RAINVIEWER_OVERLAYS[0];
const satellite = RAINVIEWER_OVERLAYS[1];

function weatherMaps(radarTime, satTime = radarTime) {
  return {
    host: 'https://tilecache.rainviewer.com',
    generated: radarTime,
    radar: { past: [{ time: radarTime, path: `/v2/radar/${radarTime}` }] },
    satellite: { infrared: [{ time: satTime, path: `/v2/satellite/${satTime}` }] },
  };
}

/** Scene stand-ins recording imagery add/remove. */
function harness({ globeShow = true, frames = weatherMaps(1_700_000_000), fetchImpl = null } = {}) {
  const added = [];
  const removed = [];
  const listeners = new Map();
  let fetchCount = 0;
  class FakeProvider { constructor(options) { this.options = options; } }
  class FakeImageryLayer { constructor(provider) { this.provider = provider; this.alpha = 1; } }
  const viewer = {
    scene: { globe: { show: globeShow } },
    imageryLayers: {
      add: (layer) => added.push(layer),
      remove: (layer, destroy) => removed.push({ layer, destroy }),
    },
  };
  const deps = {
    UrlTemplateImageryProvider: FakeProvider,
    ImageryLayer: FakeImageryLayer,
    Credit: class { constructor(text) { this.text = text; } },
    eventTarget: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
    },
    requestRender: () => {},
    now: () => 1_700_000_000_000,
    fetchImpl: fetchImpl || (async () => {
      fetchCount += 1;
      return { ok: true, json: async () => frames };
    }),
  };
  return { viewer, deps, added, removed, listeners, fetchCount: () => fetchCount };
}

test('both overlays ship with distinct ids, tokens and rendering options', () => {
  assert.deepEqual(RAINVIEWER_OVERLAY_IDS, ['rainviewer-radar', 'rainviewer-satellite']);
  assert.equal(new Set(RAINVIEWER_OVERLAYS.map((o) => o.token)).size, 2);
  assert.notDeepEqual(radar.options, satellite.options);
});

test('both are SEMI-transparent, and radar sits heavier than cloud context', () => {
  for (const overlay of RAINVIEWER_OVERLAYS) {
    assert.ok(overlay.alpha > 0 && overlay.alpha < 1, `${overlay.id} must be semi-transparent`);
  }
  assert.ok(radar.alpha > satellite.alpha, 'cloud cover is context beneath precipitation');
});

test('the poll interval matches RainViewer\'s own publication cadence', () => {
  assert.equal(RAINVIEWER_POLL_MS, 10 * 60 * 1000);
  for (const overlay of RAINVIEWER_OVERLAYS) {
    const layer = createRainviewerLayer(overlay, {});
    assert.equal(layer.updateInterval, RAINVIEWER_POLL_MS, `${overlay.id} polls on cadence`);
  }
});

test('RADAR DECLARES ITS COVERAGE GAP — blank is not "no rain"', () => {
  assert.match(radar.caveat, /BLANK ≠ NO RAIN/);
  assert.match(radar.caveat, /RADAR NETWORKS ONLY/);
});

test('the satellite overlay says what IR actually measures', () => {
  // Cloud-top temperature is not rainfall, and the two overlays look similar.
  assert.match(satellite.caveat, /NOT RAINFALL/);
  assert.match(satellite.caveat, /NEAR-GLOBAL/);
});

test('enable then update adds exactly one imagery layer at the frame alpha', async () => {
  resetFrameCache();
  const { viewer, deps, added } = harness();
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  assert.equal(added.length, 0, 'enable alone does not fetch or draw');

  assert.equal(await layer.update(), true);
  assert.equal(added.length, 1);
  assert.equal(added[0].alpha, radar.alpha);
  assert.match(added[0].provider.options.url, /\/v2\/radar\/1700000000\/512\/\{z\}\/\{x\}\/\{y\}\/2\/1_1\.png$/);
});

test('SAME-FRAME POLL IS A NO-OP: no add, no remove, nothing touched', async () => {
  resetFrameCache();
  const { viewer, deps, added, removed } = harness();
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();
  assert.equal(added.length, 1);

  // Three more polls, same published frame.
  for (let i = 0; i < 3; i += 1) {
    resetFrameCache();
    assert.equal(await layer.update(), true);
  }
  assert.equal(added.length, 1, 'live imagery was never rebuilt');
  assert.equal(removed.length, 0, 'and never torn down');
  assert.equal(layer.getFrameState().unchangedPolls, 3, 'the no-ops are counted');
});

test('a NEW frame swaps the imagery, adding before removing so nothing flashes', async () => {
  resetFrameCache();
  const state = { frames: weatherMaps(1_700_000_000) };
  const { viewer, deps, added, removed } = harness({
    fetchImpl: async () => ({ ok: true, json: async () => state.frames }),
  });
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();

  resetFrameCache();
  state.frames = weatherMaps(1_700_000_600);
  await layer.update();

  assert.equal(added.length, 2, 'the new frame is added');
  assert.equal(removed.length, 1, 'and the old one removed after it');
  assert.equal(removed[0].layer, added[0], 'the removed layer is the previous frame');
  assert.equal(removed[0].destroy, true);
  assert.match(added[1].provider.options.url, /1700000600/);
  assert.equal(layer.getFrameState().frameTime, 1_700_000_600);
});

test('ONE REQUEST SERVES BOTH OVERLAYS — the frame document carries both', async () => {
  resetFrameCache();
  const h = harness();
  const radarLayer = createRainviewerLayer(radar, h.deps);
  const satLayer = createRainviewerLayer(satellite, h.deps);
  radarLayer.init(h.viewer);
  satLayer.init(h.viewer);
  radarLayer.enable();
  satLayer.enable();

  await Promise.all([radarLayer.update(), satLayer.update()]);
  assert.equal(h.fetchCount(), 1, 'two layers polling together share one fetch');
  assert.equal(h.added.length, 2, 'but each gets its own imagery layer');
});

test('each overlay reads its OWN frame out of the shared document', async () => {
  resetFrameCache();
  const h = harness({ frames: weatherMaps(1_700_000_000, 1_700_000_300) });
  const radarLayer = createRainviewerLayer(radar, h.deps);
  const satLayer = createRainviewerLayer(satellite, h.deps);
  radarLayer.init(h.viewer);
  satLayer.init(h.viewer);
  radarLayer.enable();
  satLayer.enable();
  await radarLayer.update();
  await satLayer.update();
  assert.equal(radarLayer.getFrameState().frameTime, 1_700_000_000);
  assert.equal(satLayer.getFrameState().frameTime, 1_700_000_300);
  assert.match(h.added[1].provider.options.url, /satellite/);
});

test('disable removes the imagery and forgets the frame so re-enable redraws', async () => {
  resetFrameCache();
  const { viewer, deps, added, removed } = harness();
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();
  layer.disable();
  assert.equal(removed.length, 1);
  assert.equal(layer.getFrameState().frameTime, null,
    'a remembered timestamp would make the next poll a no-op with nothing drawn');

  resetFrameCache();
  layer.enable();
  await layer.update();
  assert.equal(added.length, 2, 're-enabling draws again');
});

test('a disabled layer does not poll at all', async () => {
  resetFrameCache();
  const h = harness();
  const layer = createRainviewerLayer(radar, h.deps);
  layer.init(h.viewer);
  assert.equal(await layer.update(), true);
  assert.equal(h.fetchCount(), 0);
});

test('a failed refresh KEEPS the frame on screen — stale beats blank', async () => {
  resetFrameCache();
  let fail = false;
  const { viewer, deps, added, removed } = harness({
    fetchImpl: async () => {
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => weatherMaps(1_700_000_000) };
    },
  });
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();

  resetFrameCache();
  fail = true;
  assert.equal(await layer.update(), false);
  assert.equal(removed.length, 0, 'the last good frame stays up');
  assert.equal(added.length, 1);
  assert.match(layer.getStats().error, /UNAVAILABLE/);
});

test('an HTTP failure reports rather than throwing', async () => {
  resetFrameCache();
  const { viewer, deps } = harness({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), false);
  assert.match(layer.getStats().error, /UNAVAILABLE/);
});

test('a payload with no frame for this overlay clears rather than inventing one', async () => {
  resetFrameCache();
  const { viewer, deps, removed } = harness({
    frames: { host: 'https://h', radar: { past: [] }, satellite: { infrared: [] } },
  });
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getFrameState().frameTime, null);
  assert.match(layer.getStats().statusText, /NO FRAME AVAILABLE/);
  assert.equal(removed.length, 0, 'nothing was drawn, so nothing needed removing');
});

test('STATUS: on but hidden under Google 3D says exactly that', () => {
  const text = rainviewerStatusText({ enabled: true, globeVisible: false }, radar);
  assert.match(text, /HIDDEN ON GOOGLE 3D/);
  assert.match(text, /SWITCH MAP SOURCE/);
});

test('STATUS: a live frame reports its age and its caveat together', () => {
  const text = rainviewerStatusText(
    { enabled: true, globeVisible: true, frameTime: 1_700_000_000 },
    radar,
    1_700_000_600_000,
  );
  assert.match(text, /PRECIPITATION REFLECTIVITY/);
  assert.match(text, /10 MIN OLD/);
  assert.match(text, /BLANK ≠ NO RAIN/);
});

test('STATUS: a disabled overlay still states its caveat up front', () => {
  const text = rainviewerStatusText({ enabled: false }, radar);
  assert.match(text, /BLANK ≠ NO RAIN/, 'the caveat is visible before switching it on');
});

test('STATUS: errors and first load take priority over frame age', () => {
  assert.equal(
    rainviewerStatusText({ enabled: true, globeVisible: true, error: 'RAINVIEWER UNAVAILABLE' }, radar),
    'RAINVIEWER UNAVAILABLE',
  );
  assert.equal(
    rainviewerStatusText({ enabled: true, globeVisible: true, loading: true, frameTime: null }, radar),
    'LOADING FRAME',
  );
});

test('isVisible requires enabled AND a visible globe AND drawn imagery', async () => {
  resetFrameCache();
  const { viewer, deps } = harness({ globeShow: false });
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();
  assert.equal(layer.isVisible(), false, 'hidden globe');

  viewer.scene.globe.show = true;
  deps.eventTarget.addEventListener; // listener already registered at init
  assert.equal(layer.getFrameState().hasImagery, true);
});

test('a map-stack change flips reported visibility with no reload', async () => {
  resetFrameCache();
  const { viewer, deps, listeners, added } = harness({ globeShow: false });
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();
  assert.equal(layer.isVisible(), false);

  viewer.scene.globe.show = true;
  listeners.get('gev:map-stack-changed')();
  assert.equal(layer.isVisible(), true);
  assert.equal(added.length, 1, 'revealing did not re-request imagery');
});

test('the shared frame cache serves a second caller without re-fetching', async () => {
  resetFrameCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => weatherMaps(1_700_000_000) };
  };
  const now = () => 1_700_000_000_000;
  await loadFrames({ fetchImpl, now });
  await loadFrames({ fetchImpl, now });
  assert.equal(calls, 1);
});

test('invalidateFrameCache forces the next poll to re-fetch', async () => {
  // The shared cache is module-level, which is what makes one request serve
  // both overlays — but without this seam nothing could force a refresh inside
  // the TTL, including a manual refresh or a resumed tab.
  resetFrameCache();
  const state = { frames: weatherMaps(1_700_000_000) };
  let calls = 0;
  const { viewer, deps, added } = harness({
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => state.frames }; },
  });
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();
  assert.equal(calls, 1);

  // Inside the TTL the cache holds, so a poll does not re-fetch.
  await layer.update();
  assert.equal(calls, 1);

  state.frames = weatherMaps(1_700_000_600);
  layer.invalidateFrameCache();
  await layer.update();
  assert.equal(calls, 2, 'the seam dropped the cache');
  assert.equal(layer.getFrameState().frameTime, 1_700_000_600);
  assert.equal(added.length, 2, 'and the new frame was drawn');
});

test('destroy removes imagery and unsubscribes', async () => {
  resetFrameCache();
  const { viewer, deps, removed, listeners } = harness();
  const layer = createRainviewerLayer(radar, deps);
  layer.init(viewer);
  layer.enable();
  await layer.update();
  layer.destroy();
  assert.equal(removed.length, 1);
  assert.equal(listeners.size, 0);
});
