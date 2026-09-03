/**
 * @module data/acledEvents
 * @description ACLED (Armed Conflict Location & Event Data Project) —
 * human-coded political-violence and protest events.
 *
 * Both GDELT layers in this app are machine-extracted from news text. This
 * one is different: ACLED's regional research teams code each record from
 * media, partner, and local source reporting, geocoded to a specific
 * locality where possible with an explicit precision flag — higher
 * confidence than either GDELT layer, still not first-hand verification.
 *
 * ## Optional, bring-your-own-key, same shape as Global Fishing Watch
 *
 * Off by default. `/api/acled-events` returns 503 `{error:'no_key'}` until
 * the operator supplies their own free ACLED registration credentials, and
 * the layer reads that as a configured terminal state (`KEY REQUIRED`), not
 * an error — see `acledEventsStatusText`.
 *
 * ## Licence
 *
 * Free for non-commercial use under ACLED's own EULA — not a Creative
 * Commons licence, and stricter than most sources this app fetches.
 * Recorded in DATA_SOURCES.md next to the Global Fishing Watch warning.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  ACLED_PRESETS,
  DEFAULT_ACLED_PRESET_ID,
  resolveAcledPreset,
  acledEventPixelSize,
} from './acledEventsShape.js';

const API_URL = '/api/acled-events';
/** ACLED's own pipeline updates weekly; polling faster only spends the quota. */
const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Honest one-line status for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function acledEventsStatusText(state) {
  if (state.keyMissing) return 'UNAVAILABLE · ACLED · KEY REQUIRED';
  if (state.error) return state.error;
  if (state.loading) return 'LOADING ACLED EVENTS';
  const preset = resolveAcledPreset(state.presetId);
  const label = preset ? preset.label : 'ACLED EVENTS';
  if (state.count === 0) return `${label} · NONE IN WINDOW`;
  const parts = [`${label} · ${state.count}`];
  if (state.truncated && Number.isFinite(state.total)) {
    parts.push(`OF ${state.total} — MOST RECENT SHOWN`);
  }
  parts.push(`${state.windowDays}D WINDOW`);
  // The hedge is part of the status, not a tooltip someone has to find.
  parts.push('NOT INDEPENDENTLY VERIFIED');
  return parts.join(' · ');
}

export function createAcledEventsLayer({ fetchImpl = null } = {}) {
  let _dataSource = null;
  let _enabled = false;
  let _abort = null;
  const state = {
    presetId: DEFAULT_ACLED_PRESET_ID,
    count: 0,
    total: null,
    truncated: false,
    windowDays: 30,
    loading: false,
    error: null,
    keyMissing: false,
    lastUpdate: null,
    events: [],
  };

  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function draw() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    const preset = resolveAcledPreset(state.presetId);
    const color = Cesium.Color.fromCssColorString(preset?.accent || '#ff4d3d');
    for (const event of state.events) {
      _dataSource.entities.add({
        id: `acled-event-${event.id}`,
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat, 1000),
        point: {
          color: color.withAlpha(event.precision === 'exact' ? 0.85 : 0.55),
          outlineColor: color.withAlpha(0.35),
          outlineWidth: 2,
          pixelSize: acledEventPixelSize(event.fatalities),
        },
        properties: {
          kind: 'acled-event',
          type: event.type,
          country: event.country,
          location: event.location,
          actor1: event.actor1,
          actor2: event.actor2,
          fatalities: event.fatalities,
          precision: event.precision,
          source: event.source,
          caveat: event.caveat,
        },
      });
    }
    governorRequestRender('acled-events');
  }

  const layer = {
    id: 'acled-events',
    name: 'ACLED Events',
    icon: '🎯',
    source: 'ACLED',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('acled-events');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _enabled = false;
      console.log('[Data:ACLED] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      governorRequestRender('acled-events-enable');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('acled-events-disable');
    },

    setReplaySuppressed(suppressed) {
      if (!_enabled || !_dataSource) return;
      _dataSource.show = !suppressed;
    },

    /** Selectable event types, for UI and voice. */
    getPresets() {
      return ACLED_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        active: preset.id === state.presetId,
      }));
    },

    /**
     * Switch event type. Refuses anything outside the preset table.
     * @param {string} presetId Preset id.
     * @returns {boolean} True when the type changed.
     */
    setPreset(presetId) {
      if (!resolveAcledPreset(presetId) || presetId === state.presetId) return false;
      state.presetId = presetId;
      state.events = [];
      state.count = 0;
      draw();
      return true;
    },

    /** `enabled+options` contract — the one persisted/shareable field is the event type. */
    getParams() {
      return { preset: state.presetId };
    },

    setParams(params = {}) {
      if (params.preset === undefined) return true;
      if (!resolveAcledPreset(params.preset)) return false;
      layer.setPreset(params.preset);
      return true;
    },

    /** Working preset chip row, same pattern as the GDELT CAMEO layer. */
    getRowControls() {
      return {
        chips: ACLED_PRESETS.map((preset) => ({
          id: preset.id,
          label: preset.label,
          active: preset.id === state.presetId,
          params: { preset: preset.id },
        })),
        legend: [],
      };
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
        if (response.status === 503) {
          // A declared missing optional key is a configured terminal state,
          // not a fault: the row reads KEY REQUIRED and the poll stays cheap.
          state.keyMissing = true;
          state.error = null;
          state.events = [];
          state.count = 0;
          draw();
          return true;
        }
        state.keyMissing = false;
        if (!response.ok) {
          state.error = `ACLED EVENT FEED HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.events)) {
          state.error = 'MALFORMED ACLED RESPONSE';
          return false;
        }
        if (payload.preset !== state.presetId) return true;
        state.events = payload.events;
        state.count = payload.events.length;
        state.truncated = payload.truncated === true;
        state.total = Number.isFinite(payload.total) ? payload.total : null;
        state.windowDays = Number.isFinite(payload.windowDays) ? payload.windowDays : 30;
        state.lastUpdate = Date.now();
        state.error = null;
        draw();
        console.log(`[Data:ACLED] ${state.count} ${state.presetId}`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'ACLED EVENT FEED UNAVAILABLE';
        console.warn('[Data:ACLED] fetch error:', error);
        return false;
      } finally {
        state.loading = false;
        _abort = null;
      }
    },

    destroy(viewer) {
      _enabled = false;
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      state.events = [];
      state.count = 0;
      state.lastUpdate = null;
      state.error = null;
    },

    /** Analyst records. `kind` marks these as sourced reports, not verified sightings. */
    getAnalystRecords(maxCount = 600) {
      if (!_enabled || !state.events.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 600;
      return state.events.slice(0, limit).map((event) => ({
        id: event.id,
        kind: 'sourced-conflict-event',
        lat: event.lat,
        lon: event.lon,
        eventType: event.type,
        precision: event.precision,
        fatalities: event.fatalities,
        country: event.country,
      }));
    },

    getStats() {
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        error: state.error,
        loading: state.loading,
        truncated: state.truncated,
        // The manager's honest-chip reducer reads these for KEY REQUIRED.
        unavailable: state.keyMissing,
        status: acledEventsStatusText(state),
        coverage: 'GLOBAL, LOCALITY-CODED WHERE POSSIBLE',
      };
    },
  };

  return layer;
}

const acledEventsLayer = createAcledEventsLayer();

export default acledEventsLayer;
