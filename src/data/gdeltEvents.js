/**
 * @module data/gdeltEvents
 * @description Global event reporting, geocoded — where the world is being
 * written about right now.
 *
 * Every other live layer here answers "where is this thing". This one answers
 * "where is something being reported", across worldwide coverage in 65
 * machine-translated languages, over the trailing 24 hours. It is the widest
 * net in the app and the only layer whose subject is the reporting itself.
 *
 * ## What a dot means, and what it does not
 *
 * A dot is a PLACE THAT WAS MENTIONED in coverage matching the selected theme.
 * It is not an event, not a confirmed incident, and not a count of incidents.
 * Ten dots in a region can be ten articles about one thing. The layer says
 * "MENTIONS" everywhere it says anything, because "events" would be a claim
 * the data cannot support.
 *
 * Media attention is also wildly uneven: an English-language wire story lands
 * far more mentions than an equivalent event covered locally in one language.
 * An empty region means nobody in GDELT's monitored sources wrote about it —
 * never that nothing happened there. The layer's status line says so.
 *
 * ## Themes, not searches
 *
 * The layer offers a fixed set of themes and cannot be pointed at free text;
 * the refusal lives in the proxy (see gdeltEventsShape.js). This project does
 * not build named-person search, and GDELT's API would happily serve one.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  GDELT_PRESETS,
  DEFAULT_GDELT_PRESET_ID,
  resolvePreset,
  mentionPixelSize,
} from './gdeltEventsShape.js';

const API_URL = '/api/gdelt/geo';

/** Poll cadence. GDELT recomputes about every 15 minutes. */
const UPDATE_INTERVAL_MS = 8 * 60 * 1000;

/**
 * Honest one-line status for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function gdeltStatusText(state) {
  if (state.error) return state.error;
  if (state.loading) return 'LOADING REPORTING';
  const preset = resolvePreset(state.presetId);
  const label = preset ? preset.label : 'EVENTS';
  if (state.count === 0) return `${label} · NO REPORTING IN 24H`;
  const parts = [`${label} · ${state.count} PLACES MENTIONED`];
  if (state.truncated && Number.isFinite(state.totalFeatures)) {
    parts.push(`OF ${state.totalFeatures} — MOST-REPORTED SHOWN`);
  }
  parts.push('24H MEDIA COVERAGE · NOT AN EVENT COUNT');
  return parts.join(' · ');
}

export function createGdeltEventsLayer({ fetchImpl = null } = {}) {
  let _points = null;
  let _viewer = null;
  let _enabled = false;
  let _abort = null;
  const state = {
    presetId: DEFAULT_GDELT_PRESET_ID,
    count: 0,
    totalFeatures: null,
    truncated: false,
    maxMentions: 0,
    loading: false,
    error: null,
    lastUpdate: null,
    records: [],
  };

  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function draw() {
    if (!_points) return;
    _points.removeAll();
    const preset = resolvePreset(state.presetId);
    const color = Cesium.Color.fromCssColorString(preset?.accent || '#ffd23f');
    for (const record of state.records) {
      _points.add({
        position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat, 2000),
        color: color.withAlpha(0.78),
        outlineColor: color.withAlpha(0.35),
        outlineWidth: 2,
        pixelSize: mentionPixelSize(record.mentions, state.maxMentions),
      });
    }
    governorRequestRender('gdelt-events');
  }

  const layer = {
    id: 'gdelt-events',
    name: 'Global Reporting',
    icon: '📰',
    source: 'GDELT',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      _points.show = false;
      _enabled = false;
      console.log('[Data:GDELT] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      governorRequestRender('gdelt-enable');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('gdelt-disable');
    },

    /** Hide during timeline replay — see the same hook on flights.js. */
    setReplaySuppressed(suppressed) {
      if (!_enabled || !_points) return;
      _points.show = !suppressed;
    },

    /** Selectable themes, for UI and voice. */
    getPresets() {
      return GDELT_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        description: preset.description,
        active: preset.id === state.presetId,
      }));
    },

    /**
     * Switch theme. Refuses anything not in the preset table — the same
     * closed allowlist the proxy enforces.
     * @param {string} presetId Preset id.
     * @returns {boolean} True when the theme changed.
     */
    setPreset(presetId) {
      if (!resolvePreset(presetId) || presetId === state.presetId) return false;
      state.presetId = presetId;
      state.records = [];
      state.count = 0;
      state.maxMentions = 0;
      draw();
      return true;
    },

    async update() {
      if (!_enabled) return true;
      state.loading = true;
      _abort = new AbortController();
      try {
        const response = await doFetch(
          `${API_URL}?preset=${encodeURIComponent(state.presetId)}`,
          { signal: _abort.signal },
        );
        if (!response.ok) {
          state.error = `GDELT FEED HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.records)) {
          state.error = 'MALFORMED GDELT RESPONSE';
          return false;
        }
        // A response for a theme the operator has since switched away from is
        // discarded rather than drawn under the new label.
        if (payload.preset !== state.presetId) return true;
        state.records = payload.records;
        state.count = payload.records.length;
        state.maxMentions = Number.isFinite(payload.maxMentions) ? payload.maxMentions : 0;
        state.truncated = payload.truncated === true;
        state.totalFeatures = Number.isFinite(payload.totalFeatures) ? payload.totalFeatures : null;
        state.lastUpdate = Date.now();
        state.error = null;
        draw();
        console.log(`[Data:GDELT] ${state.count} places (${state.presetId})`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'GDELT FEED UNAVAILABLE';
        console.warn('[Data:GDELT] fetch error:', error);
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
      state.records = [];
      state.count = 0;
      state.lastUpdate = null;
      state.error = null;
    },

    /**
     * Analyst records. `kind` marks these as reporting rather than observed
     * objects, so a query cannot silently treat a mention as a sighting.
     */
    getAnalystRecords(maxCount = 750) {
      if (!_enabled || !state.records.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 750;
      return state.records.slice(0, limit).map((record) => ({
        id: record.name,
        kind: 'media-mention',
        lat: record.lat,
        lon: record.lon,
        mentions: record.mentions,
        theme: state.presetId,
        summary: record.summary,
      }));
    },

    getStats() {
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        error: state.error,
        loading: state.loading,
        truncated: state.truncated,
        totalFeatures: state.totalFeatures,
        coverage: 'GLOBAL MEDIA · 24H',
        status: gdeltStatusText(state),
      };
    },
  };

  return layer;
}

const gdeltEventsLayer = createGdeltEventsLayer();

export default gdeltEventsLayer;
