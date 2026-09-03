/**
 * @module data/gdeltCameoEvents
 * @description GDELT Event Database 2.0 — CAMEO-typed, actor/action-geocoded
 * "Geopolitical Events" layer.
 *
 * The existing GDELT "Global Reporting" layer (`gdeltEvents.js`) draws PLACES
 * MENTIONED in matching news coverage. This layer draws something more
 * specific: individual reported events, each carrying a CAMEO event type
 * (protest, armed conflict/violence, diplomatic engagement), a Goldstein
 * cooperation/conflict score, and its own geocoded position — with an
 * explicit precision flag (country/region/locality) so a country-level dot
 * never reads as street-level.
 *
 * ## Still "reported," never "confirmed"
 *
 * These records are still machine-extracted from news text by GDELT's own
 * pipeline, not human-vetted. The status line says "REPORTED", never
 * "EVENTS" bare, for the same reason the mentions layer never says
 * "events" — see that module's doc for the full argument.
 *
 * ## A rolling buffer, not a 24h window
 *
 * GDELT's Event 2.0 database is only published as 15-minute bulk exports —
 * there is no server-side query API for it the way GEO 2.0 has. The proxy
 * behind `/api/gdelt/cameo-events` keeps a rolling few-hour buffer built by
 * polling only the newest interval each cycle; it does not claim 24h
 * coverage the way the mentions layer does. `getStats().coverage` says so.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  CAMEO_PRESETS,
  DEFAULT_CAMEO_PRESET_ID,
  resolveCameoPreset,
} from './gdeltCameoEventsShape.js';
import { mentionPixelSize } from './gdeltEventsShape.js';

const API_URL = '/api/gdelt/cameo-events';

/** Poll cadence — GDELT's own publish cadence is 15 minutes; this stays under half that. */
const UPDATE_INTERVAL_MS = 7 * 60 * 1000;

/**
 * Honest one-line status for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function gdeltCameoStatusText(state) {
  if (state.keyMissing) return 'UNAVAILABLE'; // reserved for parity with BYOK layers; unused here
  if (state.error) return state.error;
  if (state.loading && !state.lastUpdate) return 'LOADING GEOPOLITICAL EVENTS';
  const preset = resolveCameoPreset(state.presetId);
  const label = preset ? preset.label : 'EVENTS';
  if (state.warming) return `${label} · BUFFER WARMING UP — REPORTED EVENTS, NOT CONFIRMED`;
  if (state.count === 0) return `${label} · NO REPORTED EVENTS IN BUFFER`;
  const parts = [`${label} · ${state.count} REPORTED EVENTS`];
  if (state.truncated && Number.isFinite(state.totalFeatures)) {
    parts.push(`OF ${state.totalFeatures} — MOST-REPORTED SHOWN`);
  }
  parts.push('ROLLING BUFFER · NOT CONFIRMED INCIDENTS');
  return parts.join(' · ');
}

export function createGdeltCameoEventsLayer({ fetchImpl = null } = {}) {
  let _points = null;
  let _viewer = null;
  let _enabled = false;
  let _abort = null;
  let _rowControlsListener = null;
  const state = {
    presetId: DEFAULT_CAMEO_PRESET_ID,
    count: 0,
    totalFeatures: null,
    truncated: false,
    maxMentions: 0,
    warming: false,
    loading: false,
    error: null,
    lastUpdate: null,
    records: [],
  };

  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function draw() {
    if (!_points) return;
    _points.removeAll();
    const preset = resolveCameoPreset(state.presetId);
    const color = Cesium.Color.fromCssColorString(preset?.accent || '#ffd23f');
    for (const record of state.records) {
      _points.add({
        position: Cesium.Cartesian3.fromDegrees(record.lon, record.lat, 2000),
        color: color.withAlpha(record.precision === 'locality' ? 0.85 : 0.55),
        outlineColor: color.withAlpha(0.35),
        outlineWidth: 2,
        pixelSize: mentionPixelSize(record.numMentions, state.maxMentions),
      });
    }
    governorRequestRender('gdelt-cameo-events');
  }

  const layer = {
    id: 'gdelt-cameo-events',
    name: 'Geopolitical Events',
    icon: '⚔️',
    source: 'GDELT Event DB 2.0',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _viewer = viewer;
      _points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
      _points.show = false;
      _enabled = false;
      console.log('[Data:GDELT-CAMEO] Initialized');
    },

    enable() {
      _enabled = true;
      if (_points) _points.show = true;
      governorRequestRender('gdelt-cameo-enable');
    },

    disable() {
      _enabled = false;
      if (_points) _points.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('gdelt-cameo-disable');
    },

    setReplaySuppressed(suppressed) {
      if (!_enabled || !_points) return;
      _points.show = !suppressed;
    },

    /** Selectable themes, for UI and voice. */
    getPresets() {
      return CAMEO_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        description: preset.description,
        active: preset.id === state.presetId,
      }));
    },

    /**
     * Switch theme. Refuses anything not in the preset table.
     * @param {string} presetId Preset id.
     * @returns {boolean} True when the theme changed.
     */
    setPreset(presetId) {
      if (!resolveCameoPreset(presetId) || presetId === state.presetId) return false;
      state.presetId = presetId;
      state.records = [];
      state.count = 0;
      state.maxMentions = 0;
      draw();
      _rowControlsListener?.();
      return true;
    },

    /** `enabled+options` contract — the one persisted/shareable field is the theme. */
    getParams() {
      return { preset: state.presetId };
    },

    setParams(params = {}) {
      if (params.preset === undefined) return true;
      if (!resolveCameoPreset(params.preset)) return false;
      layer.setPreset(params.preset);
      return true;
    },

    /** Working preset chip row — the mentions layer's own preset switcher has no UI at all. */
    getRowControls() {
      return {
        chips: CAMEO_PRESETS.map((preset) => ({
          id: preset.id,
          label: preset.label,
          active: preset.id === state.presetId,
          title: preset.description,
          params: { preset: preset.id },
        })),
        legend: [],
      };
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
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
          state.error = `GDELT CAMEO FEED HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.records)) {
          state.error = 'MALFORMED GDELT CAMEO RESPONSE';
          return false;
        }
        // A response for a theme the operator has since switched away from is
        // discarded rather than drawn under the new label.
        if (payload.preset !== state.presetId) return true;
        state.records = payload.records;
        state.count = payload.records.length;
        let maxMentions = 0;
        for (const record of state.records) {
          if (record.numMentions > maxMentions) maxMentions = record.numMentions;
        }
        state.maxMentions = maxMentions;
        state.truncated = payload.truncated === true;
        state.totalFeatures = Number.isFinite(payload.totalFeatures) ? payload.totalFeatures : null;
        state.warming = payload.warming === true;
        state.lastUpdate = Date.now();
        state.error = null;
        draw();
        console.log(`[Data:GDELT-CAMEO] ${state.count} events (${state.presetId})`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'GDELT CAMEO FEED UNAVAILABLE';
        console.warn('[Data:GDELT-CAMEO] fetch error:', error);
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
     * Analyst records. `kind` marks these as reported events rather than
     * confirmed incidents, so a query cannot silently treat one as verified.
     */
    getAnalystRecords(maxCount = 750) {
      if (!_enabled || !state.records.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 750;
      return state.records.slice(0, limit).map((record) => ({
        id: record.id,
        kind: 'reported-event',
        lat: record.lat,
        lon: record.lon,
        precision: record.precision,
        rootCode: record.rootCode,
        goldstein: record.goldstein,
        numMentions: record.numMentions,
        theme: state.presetId,
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
        warming: state.warming,
        coverage: 'ROLLING BUFFER · NOT 24H',
        status: gdeltCameoStatusText(state),
      };
    },
  };

  return layer;
}

const gdeltCameoEventsLayer = createGdeltCameoEventsLayer();

export default gdeltCameoEventsLayer;
