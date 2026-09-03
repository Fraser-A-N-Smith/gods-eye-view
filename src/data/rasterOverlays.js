/**
 * @module data/rasterOverlays
 * @description Independently toggleable open-data raster overlays.
 *
 * Transparent tile layers composited onto the Cesium globe as
 * `Cesium.ImageryLayer`s: OpenSeaMap sea marks (buoys, beacons, lighthouses,
 * harbours), OpenSnowMap ski pistes, OpenRailwayMap rail tracks (tracks,
 * stations, electrification), and a CARTO admin-boundaries-and-place-names
 * reference layer (country/state outlines + city/place labels, the "turn on
 * labels over the satellite view" layer Google Maps' hybrid mode ships by
 * default). All are keyless, OSM-derived, and render above whichever base
 * imagery stack is active.
 *
 * ## They only appear on a globe-imagery stack, and the layer says so
 *
 * Cesium imagery draws on the globe surface, and this app hides the globe
 * whenever Google Photorealistic 3D Tiles are active — `globe.show = false` in
 * main.js, because 2D imagery clips through 3D buildings at close range. The
 * photoreal stack is also the DEFAULT.
 *
 * So an overlay switched on over photoreal is genuinely invisible. Rather than
 * silently drawing nothing, each layer watches the map stack and reports
 * `HIDDEN ON GOOGLE 3D · SWITCH MAP SOURCE`, so the toggle never lies about
 * being on. Switching to OSM, Bing, GIBS or Sentinel reveals it immediately —
 * no reload, because the imagery layer was there the whole time.
 *
 * (This is the same constraint that made GIBS and Copernicus map STACKS rather
 * than overlays. These three are genuinely overlays — they are transparent and
 * meant to composite — so they take the constraint instead of dodging it.)
 *
 * ## Politeness
 *
 * The seamark/piste/rail three are volunteer-run community tile servers with
 * no CDN behind them and no commercial backing. Each of those descriptors
 * caps its zoom at the depth the source actually renders, so panning past it
 * cannot turn into a 404 storm against a hobby server. The CARTO reference
 * layer is different: it's served off CARTO's own CDN (`basemaps.cartocdn.com`,
 * the same free basemap-tile service Leaflet/CARTO's own JS SDK point at),
 * and its whole point is to be legible zoomed all the way out to the
 * country/continent level — so it is the one entry here without a raised
 * `minimumLevel`.
 *
 * ## Not suppressed during timeline replay
 *
 * Unlike the moving-contact layers, these are cartography rather than
 * observations: a lighthouse was in the same place four minutes ago. Hiding
 * them during replay would remove context without removing any false claim, so
 * they deliberately do not implement `setReplaySuppressed`.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * Overlay descriptors.
 *
 * `url` is an XYZ template. Both servers publish transparent PNG tiles
 * designed to be composited over a basemap, which is exactly how they are used
 * here — neither is a standalone map.
 */
export const RASTER_OVERLAYS = Object.freeze([
  Object.freeze({
    id: 'openseamap-seamarks',
    name: 'Sea Marks',
    icon: '⚓',
    source: 'OpenSeaMap',
    token: 'o',
    url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    // OpenSeaMap renders seamark tiles to z18; beyond that the server has
    // nothing to serve and every request is a wasted round trip.
    maximumLevel: 18,
    // Seamarks are drawn from about z9 down; above that the tiles are empty,
    // so requesting them is pure noise for a volunteer server.
    minimumLevel: 9,
    credit: '© OpenSeaMap contributors (ODbL)',
    coverage: 'BUOYS · BEACONS · LIGHTHOUSES · HARBOURS',
    homepage: 'https://www.openseamap.org',
  }),
  Object.freeze({
    id: 'opensnowmap-pistes',
    name: 'Ski Pistes',
    icon: '⛷️',
    source: 'OpenSnowMap',
    token: 'y',
    url: 'https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png',
    maximumLevel: 18,
    // Pistes only exist at regional scale and below.
    minimumLevel: 8,
    credit: '© OpenSnowMap.org · © OpenStreetMap contributors (ODbL)',
    coverage: 'PISTES · LIFTS · NORDIC TRAILS',
    homepage: 'https://www.opensnowmap.org',
  }),
  Object.freeze({
    id: 'openrailwaymap-tracks',
    name: 'Rail Network',
    icon: '🚆',
    source: 'OpenRailwayMap',
    token: '0',
    url: 'https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
    // Conservative bounds matching this file's other two hobby-server
    // overlays (z9/z18 seamarks, z8/z18 pistes) rather than the style's full
    // documented range — this sandboxed environment's network egress policy
    // could not reach tiles.openrailwaymap.org to confirm the exact edges
    // live, so these are picked to be safely inside the server's real
    // coverage rather than pushed to it. Re-verify against the live tile
    // server before relying on either edge.
    maximumLevel: 18,
    minimumLevel: 8,
    credit: '© OpenRailwayMap contributors (ODbL) · © OpenStreetMap contributors',
    coverage: 'TRACKS · STATIONS · ELECTRIFICATION',
    homepage: 'https://www.openrailwaymap.org',
  }),
  Object.freeze({
    id: 'reference-boundaries-labels',
    name: 'Borders & Labels',
    icon: '🏷️',
    source: 'CARTO',
    token: 'B',
    // CARTO's "dark matter, labels only" style: transparent PNG carrying just
    // country/state-level administrative boundary lines and place-name text
    // (countries, states/provinces, cities and towns), styled with a dark
    // halo so it reads over both satellite/aerial imagery and light basemaps —
    // the same "labels reference layer over imagery" idea as Google Maps'
    // hybrid mode. No API key; CARTO's basemap CDN, not a volunteer server
    // (Cesium's own UrlTemplateImageryProvider docs use this same
    // basemaps.cartocdn.com host as their worked example). This sandboxed
    // environment's network egress policy could not reach basemaps.cartocdn.com
    // to confirm the exact tile live — same caveat as openrailwaymap-tracks
    // above — so re-verify against the live tile server before relying on it.
    url: 'https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
    maximumLevel: 18,
    // Deliberately NOT raised like the other three overlays here — country
    // outlines and place names are exactly what you want zoomed all the way
    // out, and CARTO's CDN (unlike the hobby servers above) is built for it.
    minimumLevel: 0,
    credit: '© OpenStreetMap contributors (ODbL) · Basemap styles © CARTO',
    coverage: 'COUNTRIES · STATES/PROVINCES · PLACE NAMES',
    homepage: 'https://carto.com/basemaps',
  }),
]);

/** Overlay ids, in registration order. */
export const RASTER_OVERLAY_IDS = Object.freeze(RASTER_OVERLAYS.map((overlay) => overlay.id));

/**
 * Whether the Cesium globe is currently rendering imagery at all.
 *
 * The single fact these layers depend on. Read from live scene state rather
 * than from the map-stack id, because the two can disagree during a switch and
 * the scene is the thing the operator is actually looking at.
 *
 * @param {object} viewer Cesium viewer (or a stand-in).
 * @returns {boolean}
 */
export function globeImageryVisible(viewer) {
  return viewer?.scene?.globe?.show === true;
}

/**
 * Honest one-line status for an overlay's layer chip.
 *
 * @param {object} state Layer state.
 * @param {object} descriptor Overlay descriptor.
 * @returns {string}
 */
export function rasterOverlayStatusText(state, descriptor) {
  if (!state.enabled) return descriptor.coverage;
  if (!state.globeVisible) {
    // The toggle is on and nothing is on screen. Saying so is the whole point.
    return 'HIDDEN ON GOOGLE 3D · SWITCH MAP SOURCE TO SEE THIS';
  }
  if (state.tileErrors > 0) {
    return `${descriptor.coverage} · ${state.tileErrors} TILES UNAVAILABLE`;
  }
  return `${descriptor.coverage} · ODbL`;
}

/**
 * Build a data-layer module for one raster overlay.
 *
 * @param {object} descriptor One entry from RASTER_OVERLAYS.
 * @param {object} [deps] Injected Cesium pieces, for tests.
 * @returns {object} Layer module implementing the standard lifecycle.
 */
export function createRasterOverlayLayer(descriptor, deps = {}) {
  const ImageryProvider = deps.UrlTemplateImageryProvider || Cesium.UrlTemplateImageryProvider;
  const ImageryLayerCtor = deps.ImageryLayer || Cesium.ImageryLayer;
  const CreditCtor = deps.Credit || Cesium.Credit;
  const requestRender = deps.requestRender || governorRequestRender;

  let _viewer = null;
  let _imageryLayer = null;
  let _stackListener = null;
  const state = {
    enabled: false,
    globeVisible: false,
    tileErrors: 0,
  };

  /** Re-read scene state and repaint the chip. */
  function syncGlobeVisibility() {
    const visible = globeImageryVisible(_viewer);
    if (visible === state.globeVisible) return;
    state.globeVisible = visible;
    requestRender(`${descriptor.id}-visibility`);
  }

  function addImagery() {
    if (_imageryLayer || !_viewer) return;
    const provider = new ImageryProvider({
      url: descriptor.url,
      maximumLevel: descriptor.maximumLevel,
      minimumLevel: descriptor.minimumLevel,
      credit: new CreditCtor(descriptor.credit),
    });
    // A community tile server will have gaps. Count them for the status line
    // rather than letting Cesium log an unbounded stream of console errors.
    provider.errorEvent?.addEventListener?.(() => {
      state.tileErrors += 1;
    });
    _imageryLayer = new ImageryLayerCtor(provider);
    // Appended, not inserted: MapStackController always adds the BASE imagery
    // at index 0, so anything added afterwards composites above it and stays
    // above it across stack switches.
    _viewer.imageryLayers.add(_imageryLayer);
  }

  function removeImagery() {
    if (!_imageryLayer || !_viewer) return;
    // Destroyed on removal — a disabled overlay should not keep its tile cache
    // alive, and the provider is cheap to rebuild on re-enable.
    _viewer.imageryLayers.remove(_imageryLayer, true);
    _imageryLayer = null;
  }

  return {
    id: descriptor.id,
    name: descriptor.name,
    icon: descriptor.icon,
    source: descriptor.source,
    // Static cartography: there is nothing to poll.
    updateInterval: 0,

    init(viewer) {
      _viewer = viewer;
      state.enabled = false;
      state.tileErrors = 0;
      state.globeVisible = globeImageryVisible(viewer);
      // The globe's visibility is owned by the map stack, so the chip has to
      // follow stack changes to stay truthful about whether anything shows.
      _stackListener = () => syncGlobeVisibility();
      (deps.eventTarget || globalThis.window)?.addEventListener?.('gev:map-stack-changed', _stackListener);
      console.log(`[Data:${descriptor.name}] Initialized`);
    },

    enable() {
      state.enabled = true;
      state.tileErrors = 0;
      addImagery();
      syncGlobeVisibility();
      state.globeVisible = globeImageryVisible(_viewer);
      requestRender(`${descriptor.id}-enable`);
    },

    disable() {
      state.enabled = false;
      removeImagery();
      requestRender(`${descriptor.id}-disable`);
    },

    /** Static overlay: nothing to refresh. */
    update() {
      syncGlobeVisibility();
      return Promise.resolve(true);
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

    /** True while the overlay is on AND actually visible on screen. */
    isVisible() {
      return state.enabled && state.globeVisible;
    },

    getStats() {
      return {
        // A raster overlay has no records; count is the honest zero, and the
        // status string is what the chip actually reads.
        count: state.enabled ? 1 : 0,
        lastUpdate: null,
        error: null,
        coverage: descriptor.coverage,
        // Surfaced so the manager's chip reducer can show a guidance state
        // rather than a fault when the overlay is on but the globe is hidden.
        status: state.enabled && !state.globeVisible ? 'zoom-in' : 'nominal',
        statusText: rasterOverlayStatusText(state, descriptor),
        globeVisible: state.globeVisible,
      };
    },
  };
}

/** The two shipped overlay layers, in registration order. */
const rasterOverlayLayers = RASTER_OVERLAYS.map((descriptor) => createRasterOverlayLayer(descriptor));

export default rasterOverlayLayers;
