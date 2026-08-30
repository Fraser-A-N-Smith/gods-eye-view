/**
 * @module data/spaceWeather
 * @description The aurora oval and the geomagnetic state of the planet.
 *
 * The smallest payload of any live layer here and, per byte, one of the most
 * consequential — because it is the only one that changes what the OTHER
 * layers mean. When Kp climbs, the radio layer's HF stations start fading, the
 * satellites layer's orbit predictions drift as drag rises, and every reported
 * GNSS position gets worse. The card therefore shows the operational effect
 * next to the number: "Kp 7" is not something most people can act on.
 *
 * ## The oval is a forecast
 *
 * OVATION predicts where aurora is LIKELY in the next 30–90 minutes, derived
 * from solar wind measured at L1 about a million miles upstream. It is not a
 * photograph of what is glowing now, and every surface that renders it is
 * required to say `FORECAST`. Dropping that word would turn a probability
 * field into a claimed observation.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { classifyKp, auroraStyle } from './spaceWeatherShape.js';

const API_URL = '/api/space-weather';

/** Poll cadence. OVATION republishes roughly every 5 minutes. */
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/** Height (m) at which the auroral emission layer is drawn. */
const AURORA_HEIGHT_M = 110_000;

/**
 * Honest one-line status for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function spaceWeatherStatusText(state) {
  if (state.error) return state.error;
  if (state.loading) return 'LOADING SPACE WEATHER';
  const band = classifyKp(state.kp);
  const parts = [];
  parts.push(band.kp === null ? 'KP UNKNOWN' : `KP ${band.kp.toFixed(1)} · ${band.label}`);
  parts.push(band.effect.toUpperCase());
  // Never omitted: the oval is a model output, not an observation.
  parts.push(state.count > 0 ? `${state.count} CELLS · OVATION FORECAST` : 'NO AURORA FORECAST');
  return parts.join(' · ');
}

export function createSpaceWeatherLayer({ fetchImpl = null } = {}) {
  let _points = null;
  let _viewer = null;
  let _enabled = false;
  let _abort = null;
  const state = {
    count: 0,
    kp: null,
    kpTimeTag: null,
    kpAvailable: false,
    peak: 0,
    observedAt: null,
    forecastAt: null,
    loading: false,
    error: null,
    lastUpdate: null,
    cells: [],
    // Panel-only enrichments — no globe geometry of their own (NeoWs bodies
    // have no Earth surface coordinate; DONKI/NOAA-scales are readouts, not
    // point data). Never undefined: absence is [] / [] / null, same
    // null-safety discipline as the aurora/Kp fields above.
    solarEvents: [],
    closeApproaches: [],
    radioBlackoutScale: null,
  };

  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function draw() {
    if (!_points) return;
    _points.removeAll();
    for (const cell of state.cells) {
      const style = auroraStyle(cell.probability);
      if (style.pixelSize <= 0) continue;
      _points.add({
        position: Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat, AURORA_HEIGHT_M),
        color: Cesium.Color.fromCssColorString(style.css).withAlpha(style.alpha),
        pixelSize: style.pixelSize,
      });
    }
    governorRequestRender('space-weather');
  }

  const layer = {
    id: 'space-weather',
    name: 'Space Weather',
    icon: '🌌',
    source: 'NOAA SWPC',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      _points.show = false;
      // The oval sits above the surface and should not be hidden by the globe
      // when the camera is on the far side; Cesium handles that by depth, so
      // no special casing is needed here beyond the render height.
      _enabled = false;
      console.log('[Data:SpaceWeather] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      governorRequestRender('space-weather-enable');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('space-weather-disable');
    },

    /** Hide during timeline replay — see the same hook on flights.js. */
    setReplaySuppressed(suppressed) {
      if (!_enabled || !_points) return;
      _points.show = !suppressed;
    },

    /**
     * Current geomagnetic conditions, for the HUD and voice.
     * @returns {{kp:number|null, label:string, effect:string, forecast:boolean}}
     */
    getConditions() {
      const band = classifyKp(state.kp);
      return {
        kp: band.kp,
        label: band.label,
        effect: band.effect,
        css: band.css,
        // Always true for the oval — callers must not present it as observed.
        forecast: true,
        forecastAt: state.forecastAt,
        observedAt: state.observedAt,
      };
    },

    async update() {
      if (!_enabled) return true;
      state.loading = true;
      _abort = new AbortController();
      try {
        const response = await doFetch(API_URL, { signal: _abort.signal });
        if (!response.ok) {
          state.error = `SPACE WEATHER HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.aurora)) {
          state.error = 'MALFORMED SPACE WEATHER RESPONSE';
          return false;
        }
        state.cells = payload.aurora;
        state.count = payload.aurora.length;
        state.peak = Number.isFinite(payload.auroraPeak) ? payload.auroraPeak : 0;
        state.kp = Number.isFinite(payload.kp) ? payload.kp : null;
        state.kpTimeTag = payload.kpTimeTag || null;
        state.kpAvailable = payload.kpAvailable === true;
        state.observedAt = payload.observedAt || null;
        state.forecastAt = payload.forecastAt || null;
        state.solarEvents = Array.isArray(payload.solarEvents) ? payload.solarEvents : [];
        state.closeApproaches = Array.isArray(payload.closeApproaches) ? payload.closeApproaches : [];
        state.radioBlackoutScale = payload.radioBlackoutScale
          && typeof payload.radioBlackoutScale === 'object'
          && !Array.isArray(payload.radioBlackoutScale)
          ? payload.radioBlackoutScale
          : null;
        state.lastUpdate = Date.now();
        state.error = null;
        draw();
        console.log(`[Data:SpaceWeather] ${state.count} aurora cells, Kp ${state.kp ?? 'unknown'}`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'SPACE WEATHER UNAVAILABLE';
        console.warn('[Data:SpaceWeather] fetch error:', error);
        return false;
      } finally {
        state.loading = false;
        _abort = null;
      }
    },

    destroy(viewer) {
      _enabled = false;
      const target = viewer || _viewer;
      if (_points && target?.scene && !target.isDestroyed?.()) {
        target.scene.primitives.remove(_points);
      }
      _points = null;
      _viewer = null;
      state.cells = [];
      state.count = 0;
      state.lastUpdate = null;
      state.error = null;
      state.solarEvents = [];
      state.closeApproaches = [];
      state.radioBlackoutScale = null;
    },

    getStats() {
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        error: state.error,
        loading: state.loading,
        kp: state.kp,
        coverage: 'GLOBAL · OVATION FORECAST',
        status: spaceWeatherStatusText(state),
        // Panel enrichments — never undefined, same discipline as the fields
        // above (see the `state` initializer for why: NeoWs bodies have no
        // Earth surface coordinate, so this is their only presentation).
        solarEvents: state.solarEvents,
        closeApproaches: state.closeApproaches,
        radioBlackoutScale: state.radioBlackoutScale,
      };
    },
  };

  return layer;
}

const spaceWeatherLayer = createSpaceWeatherLayer();

export default spaceWeatherLayer;
