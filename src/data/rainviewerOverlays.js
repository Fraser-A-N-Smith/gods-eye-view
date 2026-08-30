/**
 * @module data/rainviewerOverlays
 * @description Live weather radar and IR satellite, as globe imagery overlays.
 *
 * Two independently toggleable semi-transparent `Cesium.ImageryLayer`s fed by
 * RainViewer's public weather-maps API. Keyless and CORS-open, so the browser
 * fetches both the frame index and the tiles directly — no proxy, and nothing
 * server-side to configure.
 *
 * ## One frame request serves both overlays
 *
 * `weather-maps.json` carries the radar AND satellite frame lists in a single
 * document. Both layers poll the same shared, coalesced cache below, so
 * running both costs exactly one request per cycle rather than two — and two
 * layers enabled in the same tick share one in-flight request instead of
 * racing.
 *
 * ## A same-frame poll does nothing
 *
 * RainViewer publishes roughly every ten minutes, and a poll that lands
 * between publications returns the frame already on screen. Rebuilding the
 * imagery layer for that would throw away a warm tile cache, re-request every
 * visible tile, and flicker — all to draw the identical picture. So the frame
 * timestamp is compared first and an unchanged frame is a no-op that never
 * touches the scene.
 *
 * ## Coverage honesty
 *
 * **Radar is not global.** It exists where somebody built and maintains a
 * radar network; most ocean, much of Africa and central Asia, and the poles
 * have none. A blank area on the radar overlay means NO RADAR THERE, which is
 * the opposite of "no rain there" — so the layer says so on its own row. The
 * IR satellite overlay is near-global and carries no such caveat, which is
 * exactly why both are worth having.
 *
 * ## They only appear on a globe-imagery stack
 *
 * Same constraint as the OpenSeaMap/OpenSnowMap overlays: Cesium imagery draws
 * on the globe, and the app hides the globe under Google 3D tiles, which is
 * the default stack. Each layer watches the map stack and reports
 * `HIDDEN ON GOOGLE 3D` rather than presenting a lit toggle over an empty globe.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { globeImageryVisible } from './rasterOverlays.js';
import {
  RAINVIEWER_FRAMES_URL,
  RADAR_TILE_OPTIONS,
  SATELLITE_TILE_OPTIONS,
  parseWeatherMaps,
  buildTileUrl,
  frameAgeText,
} from './rainviewerFrames.js';

/** RainViewer's own publication cadence. Polling faster only re-reads the same frame. */
export const RAINVIEWER_POLL_MS = 10 * 60 * 1000;

/**
 * Shared frame cache TTL. Slightly under the poll interval so two layers
 * polling in the same cycle share one fetch, while a later cycle still
 * refreshes.
 */
export const FRAME_CACHE_TTL_MS = 9 * 60 * 1000;

/** Overlay descriptors. */
export const RAINVIEWER_OVERLAYS = Object.freeze([
  Object.freeze({
    id: 'rainviewer-radar',
    name: 'Weather Radar',
    icon: '🌧️',
    source: 'RainViewer',
    token: 'j',
    kind: 'radar',
    options: RADAR_TILE_OPTIONS,
    // Precipitation reads best over the basemap rather than instead of it.
    alpha: 0.75,
    // Beyond this the mosaic is upsampled: more requests, no more detail.
    maximumLevel: 12,
    coverage: 'PRECIPITATION REFLECTIVITY',
    // Stated on the row, not buried: blank means unwatched, not dry.
    caveat: 'RADAR NETWORKS ONLY · BLANK ≠ NO RAIN',
    credit: 'Weather radar © RainViewer',
  }),
  Object.freeze({
    id: 'rainviewer-satellite',
    name: 'IR Satellite',
    icon: '🛰️',
    source: 'RainViewer',
    token: '1',
    kind: 'satellite',
    options: SATELLITE_TILE_OPTIONS,
    // Cloud cover is context for the layers beneath it, so it sits lighter.
    alpha: 0.55,
    maximumLevel: 10,
    coverage: 'INFRARED CLOUD COVER',
    caveat: 'NEAR-GLOBAL · CLOUD TOP TEMPERATURE, NOT RAINFALL',
    credit: 'Satellite imagery © RainViewer',
  }),
]);

/** Overlay ids, in registration order. */
export const RAINVIEWER_OVERLAY_IDS = Object.freeze(RAINVIEWER_OVERLAYS.map((o) => o.id));

// ── Shared frame index ─────────────────────────────────────────────────────

let _frameCache = null;
let _frameInFlight = null;

/** Drop the shared cache. Test seam. */
export function resetFrameCache() {
  _frameCache = null;
  _frameInFlight = null;
}

/**
 * Fetch the frame index, shared across both overlays.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] Fetch seam.
 * @param {() => number} [options.now] Clock seam.
 * @param {number} [options.ttlMs] Cache lifetime.
 * @param {AbortSignal} [options.signal] Abort seam.
 * @returns {Promise<object>} Parsed frames.
 */
export async function loadFrames({
  fetchImpl = null,
  now = () => Date.now(),
  ttlMs = FRAME_CACHE_TTL_MS,
  signal = null,
} = {}) {
  if (_frameCache && now() - _frameCache.at < ttlMs) return _frameCache.frames;
  // Two layers enabled in the same tick share one request rather than racing.
  if (_frameInFlight) return _frameInFlight;

  const doFetch = fetchImpl || globalThis.fetch;
  _frameInFlight = (async () => {
    const response = await doFetch(RAINVIEWER_FRAMES_URL, { signal });
    if (!response.ok) {
      const error = new Error(`RainViewer HTTP ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    const frames = parseWeatherMaps(await response.json());
    _frameCache = { at: now(), frames };
    return frames;
  })().finally(() => { _frameInFlight = null; });

  return _frameInFlight;
}

/**
 * Honest one-line status for an overlay's layer chip.
 * @param {object} state Layer state.
 * @param {object} descriptor Overlay descriptor.
 * @param {number} [nowMs] Clock.
 * @returns {string}
 */
export function rainviewerStatusText(state, descriptor, nowMs = Date.now()) {
  if (!state.enabled) return `${descriptor.coverage} · ${descriptor.caveat}`;
  if (state.error) return state.error;
  if (!state.globeVisible) return 'HIDDEN ON GOOGLE 3D · SWITCH MAP SOURCE TO SEE THIS';
  if (state.loading && state.frameTime === null) return 'LOADING FRAME';
  if (state.frameTime === null) return `${descriptor.coverage} · NO FRAME AVAILABLE`;
  return `${descriptor.coverage} · ${frameAgeText(state.frameTime, nowMs)} · ${descriptor.caveat}`;
}

/**
 * Build a data-layer module for one RainViewer overlay.
 *
 * @param {object} descriptor One entry from RAINVIEWER_OVERLAYS.
 * @param {object} [deps] Injected seams, for tests.
 * @returns {object} Layer module implementing the standard lifecycle.
 */
export function createRainviewerLayer(descriptor, deps = {}) {
  const ImageryProvider = deps.UrlTemplateImageryProvider || Cesium.UrlTemplateImageryProvider;
  const ImageryLayerCtor = deps.ImageryLayer || Cesium.ImageryLayer;
  const CreditCtor = deps.Credit || Cesium.Credit;
  const requestRender = deps.requestRender || governorRequestRender;
  const now = deps.now || (() => Date.now());

  let _viewer = null;
  let _imageryLayer = null;
  let _stackListener = null;
  let _abort = null;
  const state = {
    enabled: false,
    globeVisible: false,
    frameTime: null,
    loading: false,
    error: null,
    /** Counts polls that found the same frame and therefore did nothing. */
    unchangedPolls: 0,
  };

  function syncGlobeVisibility() {
    const visible = globeImageryVisible(_viewer);
    if (visible === state.globeVisible) return;
    state.globeVisible = visible;
    requestRender(`${descriptor.id}-visibility`);
  }

  /**
   * Swap in a new frame's imagery.
   *
   * The new layer is added BEFORE the old is removed, so the globe is never
   * momentarily bare — a remove-then-add would flash the basemap through.
   */
  function swapFrame(url) {
    if (!_viewer) return;
    const provider = new ImageryProvider({
      url,
      maximumLevel: descriptor.maximumLevel,
      credit: new CreditCtor(descriptor.credit),
    });
    const next = new ImageryLayerCtor(provider);
    next.alpha = descriptor.alpha;
    // Appended, never inserted at 0: MapStackController owns index 0 for the
    // base imagery on every stack switch.
    _viewer.imageryLayers.add(next);
    const previous = _imageryLayer;
    _imageryLayer = next;
    if (previous) _viewer.imageryLayers.remove(previous, true);
    requestRender(`${descriptor.id}-frame`);
  }

  function removeImagery() {
    if (!_imageryLayer || !_viewer) return;
    _viewer.imageryLayers.remove(_imageryLayer, true);
    _imageryLayer = null;
  }

  return {
    id: descriptor.id,
    name: descriptor.name,
    icon: descriptor.icon,
    source: descriptor.source,
    updateInterval: RAINVIEWER_POLL_MS,

    init(viewer) {
      _viewer = viewer;
      state.enabled = false;
      state.frameTime = null;
      state.error = null;
      state.unchangedPolls = 0;
      state.globeVisible = globeImageryVisible(viewer);
      _stackListener = () => syncGlobeVisibility();
      (deps.eventTarget || globalThis.window)?.addEventListener?.('gev:map-stack-changed', _stackListener);
      console.log(`[Data:${descriptor.name}] Initialized`);
    },

    enable() {
      state.enabled = true;
      syncGlobeVisibility();
      state.globeVisible = globeImageryVisible(_viewer);
      requestRender(`${descriptor.id}-enable`);
    },

    disable() {
      state.enabled = false;
      removeImagery();
      // The frame is forgotten so re-enabling draws immediately rather than
      // treating the stale timestamp as "unchanged" and rendering nothing.
      state.frameTime = null;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      requestRender(`${descriptor.id}-disable`);
    },

    async update() {
      if (!state.enabled) return true;
      syncGlobeVisibility();
      state.loading = true;
      _abort = new AbortController();
      try {
        const frames = await loadFrames({
          fetchImpl: deps.fetchImpl,
          now,
          signal: _abort.signal,
        });
        const frame = frames?.[descriptor.kind];
        if (!frame) {
          state.error = null;
          state.frameTime = null;
          removeImagery();
          return true;
        }

        // The no-op that this layer exists to get right: an unchanged frame
        // must not rebuild live imagery.
        if (frame.time === state.frameTime && _imageryLayer) {
          state.unchangedPolls += 1;
          state.error = null;
          return true;
        }

        const url = buildTileUrl({ host: frames.host, path: frame.path, options: descriptor.options });
        if (!url) {
          state.error = 'RAINVIEWER FRAME UNUSABLE';
          return false;
        }
        swapFrame(url);
        state.frameTime = frame.time;
        state.error = null;
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        // Existing imagery is KEPT — a ten-minute-old frame beats a blank globe.
        state.error = 'RAINVIEWER UNAVAILABLE';
        console.warn(`[Data:${descriptor.name}] fetch error:`, error);
        return false;
      } finally {
        state.loading = false;
        _abort = null;
      }
    },

    destroy() {
      state.enabled = false;
      removeImagery();
      if (_stackListener) {
        (deps.eventTarget || globalThis.window)?.removeEventListener?.('gev:map-stack-changed', _stackListener);
        _stackListener = null;
      }
      _viewer = null;
    },

    /**
     * Discard the shared frame index so the next poll re-fetches.
     *
     * The cache is module-level and shared by both overlays, which is what
     * makes one request serve both — but it also means nothing could force a
     * refresh inside the cache window. This is that seam: a caller that knows
     * the cache is stale (a manual refresh, a resumed tab, a test) can drop it
     * without waiting out the TTL. Both overlays are affected, because they
     * read the same document.
     */
    invalidateFrameCache() {
      resetFrameCache();
    },

    /** True while the overlay is on AND actually visible on screen. */
    isVisible() {
      return state.enabled && state.globeVisible && _imageryLayer !== null;
    },

    /** Diagnostics, including the count of polls that correctly did nothing. */
    getFrameState() {
      return {
        frameTime: state.frameTime,
        unchangedPolls: state.unchangedPolls,
        hasImagery: _imageryLayer !== null,
      };
    },

    getStats() {
      return {
        count: _imageryLayer ? 1 : 0,
        lastUpdate: state.frameTime === null ? null : state.frameTime * 1000,
        error: state.error,
        loading: state.loading,
        coverage: descriptor.coverage,
        // A hidden overlay is guidance, not a fault — same as the other
        // globe-surface overlays.
        status: state.enabled && !state.globeVisible ? 'zoom-in' : 'nominal',
        statusText: rainviewerStatusText(state, descriptor, now()),
        globeVisible: state.globeVisible,
      };
    },
  };
}

/** The two shipped overlay layers, in registration order. */
const rainviewerLayers = RAINVIEWER_OVERLAYS.map((descriptor) => createRainviewerLayer(descriptor));

export default rainviewerLayers;
