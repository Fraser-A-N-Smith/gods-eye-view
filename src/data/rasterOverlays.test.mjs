// OpenSeaMap and OpenSnowMap raster overlays. The behaviour that matters most
// is the honest one: these draw on the Cesium globe, the app hides the globe
// under Google 3D tiles, and photoreal is the DEFAULT — so a toggle that is on
// while nothing is on screen has to say so rather than looking broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RASTER_OVERLAYS,
  RASTER_OVERLAY_IDS,
  globeImageryVisible,
  rasterOverlayStatusText,
  createRasterOverlayLayer,
} from './rasterOverlays.js';

/** Minimal Cesium stand-ins recording what the layer does to the scene. */
function harness({ globeShow = true } = {}) {
  const added = [];
  const removed = [];
  const listeners = new Map();
  class FakeProvider {
    constructor(options) {
      this.options = options;
      this.errorEvent = { addEventListener: (fn) => { this.onError = fn; } };
    }
  }
  class FakeImageryLayer {
    constructor(provider) { this.provider = provider; }
  }
  const viewer = {
    scene: { globe: { show: globeShow } },
    imageryLayers: {
      add: (layer) => added.push(layer),
      remove: (layer, destroy) => removed.push({ layer, destroy }),
    },
  };
  const eventTarget = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const deps = {
    UrlTemplateImageryProvider: FakeProvider,
    ImageryLayer: FakeImageryLayer,
    Credit: class { constructor(text) { this.text = text; } },
    eventTarget,
    requestRender: () => {},
  };
  return { viewer, deps, added, removed, listeners };
}

const seamarks = RASTER_OVERLAYS[0];
const HOBBY_SERVER_OVERLAY_IDS = ['openseamap-seamarks', 'opensnowmap-pistes', 'openrailwaymap-tracks'];

test('all four overlays ship, with distinct ids and tokens', () => {
  assert.equal(RASTER_OVERLAYS.length, 4);
  assert.deepEqual(RASTER_OVERLAY_IDS, [
    'openseamap-seamarks', 'opensnowmap-pistes', 'openrailwaymap-tracks', 'reference-boundaries-labels',
  ]);
  assert.equal(new Set(RASTER_OVERLAYS.map((o) => o.token)).size, 4);
});

test('every overlay carries ODbL attribution and a zoom range', () => {
  for (const overlay of RASTER_OVERLAYS) {
    assert.match(overlay.credit, /ODbL/, `${overlay.id} must credit its licence`);
    assert.match(overlay.url, /^https:\/\/.+\{z\}\/\{x\}\/\{y\}\.png$/, `${overlay.id} needs an XYZ template`);
    assert.ok(Number.isInteger(overlay.maximumLevel), `${overlay.id} must cap zoom`);
    assert.ok(Number.isInteger(overlay.minimumLevel), `${overlay.id} must floor zoom`);
    assert.ok(overlay.minimumLevel < overlay.maximumLevel);
  }
});

test('POLITENESS: hobby-server overlays are zoom-bounded so panning cannot 404-storm them', () => {
  // These three sources don't render tiles across the whole zoom range, and
  // run on volunteer infrastructure; requesting the empty ends is pure noise.
  for (const overlay of RASTER_OVERLAYS.filter((o) => HOBBY_SERVER_OVERLAY_IDS.includes(o.id))) {
    assert.ok(overlay.minimumLevel >= 8, `${overlay.id} should not request world-scale tiles`);
    assert.ok(overlay.maximumLevel <= 19, `${overlay.id} should not request past what exists`);
  }
});

test('the CARTO reference layer is deliberately visible zoomed all the way out', () => {
  // Country outlines and place names are exactly what you want at world
  // scale, and CARTO's CDN (unlike the hobby servers above) is built for it.
  const reference = RASTER_OVERLAYS.find((o) => o.id === 'reference-boundaries-labels');
  assert.equal(reference.minimumLevel, 0);
  assert.ok(reference.maximumLevel <= 19);
});

test('globe visibility is read from live scene state', () => {
  assert.equal(globeImageryVisible({ scene: { globe: { show: true } } }), true);
  assert.equal(globeImageryVisible({ scene: { globe: { show: false } } }), false);
  assert.equal(globeImageryVisible(null), false);
  assert.equal(globeImageryVisible({}), false, 'an unknown scene is not assumed visible');
});

test('THE HONEST CASE: on, but hidden under Google 3D, and it says exactly that', () => {
  const text = rasterOverlayStatusText({ enabled: true, globeVisible: false }, seamarks);
  assert.match(text, /HIDDEN ON GOOGLE 3D/);
  assert.match(text, /SWITCH MAP SOURCE/, 'and tells the operator what to do about it');
});

test('an enabled, visible overlay reports its content and licence', () => {
  const text = rasterOverlayStatusText({ enabled: true, globeVisible: true, tileErrors: 0 }, seamarks);
  assert.match(text, /BUOYS/);
  assert.match(text, /ODbL/);
  assert.doesNotMatch(text, /HIDDEN/);
});

test('tile gaps are counted and surfaced rather than hidden', () => {
  const text = rasterOverlayStatusText({ enabled: true, globeVisible: true, tileErrors: 7 }, seamarks);
  assert.match(text, /7 TILES UNAVAILABLE/);
});

test('a disabled overlay describes what it would show, with no false state', () => {
  const text = rasterOverlayStatusText({ enabled: false, globeVisible: true }, seamarks);
  assert.equal(text, seamarks.coverage);
  assert.doesNotMatch(text, /HIDDEN/);
});

test('enable adds one imagery layer, disable removes and destroys it', () => {
  const { viewer, deps, added, removed } = harness();
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  assert.equal(added.length, 0, 'init does not touch the scene');

  layer.enable();
  assert.equal(added.length, 1);
  assert.equal(added[0].provider.options.url, seamarks.url);
  assert.equal(added[0].provider.options.maximumLevel, seamarks.maximumLevel);

  layer.disable();
  assert.equal(removed.length, 1);
  assert.equal(removed[0].destroy, true, 'a disabled overlay must not keep its tile cache alive');
});

test('APPENDED, not inserted at 0 — the base stack owns index 0', () => {
  // MapStackController adds base imagery at index 0 on every stack switch.
  // Inserting the overlay at 0 too would put it UNDER the basemap.
  const calls = [];
  const { viewer, deps } = harness();
  viewer.imageryLayers.add = (...args) => calls.push(args);
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1, 'add() is called with no index argument');
});

test('enabling twice does not stack duplicate imagery layers', () => {
  const { viewer, deps, added } = harness();
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  layer.enable();
  assert.equal(added.length, 1);
});

test('disabling twice is harmless', () => {
  const { viewer, deps, removed } = harness();
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  layer.disable();
  layer.disable();
  assert.equal(removed.length, 1);
});

test('isVisible is false while the globe is hidden, even when enabled', () => {
  const { viewer, deps } = harness({ globeShow: false });
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  assert.equal(layer.isVisible(), false, 'on is not the same as visible');
  assert.match(layer.getStats().statusText, /HIDDEN ON GOOGLE 3D/);
});

test('a map-stack change flips the reported visibility with no reload', () => {
  // The imagery layer was there the whole time; switching stacks reveals it.
  const { viewer, deps, listeners } = harness({ globeShow: false });
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  assert.equal(layer.isVisible(), false);

  viewer.scene.globe.show = true;
  listeners.get('gev:map-stack-changed')();
  assert.equal(layer.isVisible(), true);
  assert.match(layer.getStats().statusText, /ODbL/);

  viewer.scene.globe.show = false;
  listeners.get('gev:map-stack-changed')();
  assert.equal(layer.isVisible(), false);
});

test('the hidden state is guidance, not a fault', () => {
  // The manager's chip reducer treats 'zoom-in' as a guidance state rather
  // than a feed error, which is what an overlay waiting for a globe stack is.
  const { viewer, deps } = harness({ globeShow: false });
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  const stats = layer.getStats();
  assert.equal(stats.status, 'zoom-in');
  assert.equal(stats.error, null, 'a hidden overlay is not broken');
});

test('destroy removes the imagery and unsubscribes the stack listener', () => {
  const { viewer, deps, removed, listeners } = harness();
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  layer.destroy();
  assert.equal(removed.length, 1);
  assert.equal(listeners.size, 0);
});

test('update is a no-op that only re-reads visibility — nothing to poll', async () => {
  const { viewer, deps, added } = harness();
  const layer = createRasterOverlayLayer(seamarks, deps);
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(added.length, 1, 'update does not re-add imagery');
  assert.equal(layer.updateInterval, 0, 'static cartography is not polled');
});

test('the shipped layers deliberately do NOT implement replay suppression', async () => {
  // These are cartography, not observations: a lighthouse was in the same
  // place four minutes ago. Hiding them during replay would remove context
  // without removing any false claim.
  const layers = (await import('./rasterOverlays.js')).default;
  for (const layer of layers) {
    assert.equal(typeof layer.setReplaySuppressed, 'undefined', `${layer.id}`);
  }
});

test('the shipped layers expose the standard lifecycle', async () => {
  const layers = (await import('./rasterOverlays.js')).default;
  assert.equal(layers.length, 4);
  for (const layer of layers) {
    for (const method of ['init', 'enable', 'disable', 'update', 'destroy', 'getStats']) {
      assert.equal(typeof layer[method], 'function', `${layer.id}.${method}`);
    }
    assert.ok(layer.id && layer.name && layer.icon && layer.source);
  }
});
