/**
 * @module data/vesselEvents
 * @description Vessel behaviour derived from AIS — including its absence.
 *
 * The live vessel layer draws ships that are transmitting. This one draws what
 * they were apparently DOING, and the headline case is the one a position
 * layer structurally cannot show: an AIS gap, where a vessel stopped
 * transmitting for hours or days and then reappeared somewhere else.
 *
 * This is the answer to the ceiling the project's README names — terrestrial
 * AIS goes quiet mid-ocean and satellite AIS costs real money. Global Fishing
 * Watch has already done the correlation, and gives it away for
 * non-commercial use.
 *
 * ## Everything here is apparent, never confirmed
 *
 * These are modelled interpretations of track data. A gap may be a disabled
 * transponder or a satellite coverage hole. An encounter may be a
 * transshipment or two ships passing slowly. The hedge is attached to each
 * record by the shape module so no render path can drop it, and the status
 * line repeats it.
 *
 * ## Licence
 *
 * CC BY-NC 4.0 — non-commercial only, stricter than anything else this app
 * fetches. Recorded in DATA_SOURCES.md next to the TeleGeography warning.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  VESSEL_EVENT_PRESETS,
  DEFAULT_VESSEL_EVENT_PRESET_ID,
  resolveVesselEventPreset,
  eventPixelSize,
} from './vesselEventsShape.js';

const API_URL = '/api/vessel-events';
const UPDATE_INTERVAL_MS = 20 * 60 * 1000;

/**
 * Honest one-line status for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function vesselEventsStatusText(state) {
  if (state.keyMissing) return 'UNAVAILABLE · GLOBAL FISHING WATCH · KEY REQUIRED';
  if (state.error) return state.error;
  if (state.loading) return 'LOADING VESSEL EVENTS';
  const preset = resolveVesselEventPreset(state.presetId);
  const label = preset ? preset.label : 'VESSEL EVENTS';
  if (state.count === 0) return `${label} · NONE IN WINDOW`;
  const parts = [`${label} · ${state.count}`];
  if (state.truncated && Number.isFinite(state.total)) {
    parts.push(`OF ${state.total} — LONGEST SHOWN`);
  }
  parts.push(`${state.windowDays}D WINDOW`);
  // The hedge is part of the status, not a tooltip someone has to find.
  if (preset) parts.push(preset.caveat);
  return parts.join(' · ');
}

export function createVesselEventsLayer({ fetchImpl = null } = {}) {
  let _dataSource = null;
  let _enabled = false;
  let _abort = null;
  const state = {
    presetId: DEFAULT_VESSEL_EVENT_PRESET_ID,
    count: 0,
    total: null,
    truncated: false,
    windowDays: 14,
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
    const preset = resolveVesselEventPreset(state.presetId);
    const color = Cesium.Color.fromCssColorString(preset?.accent || '#ffd23f');
    for (const event of state.events) {
      _dataSource.entities.add({
        id: `vessel-event-${event.id}`,
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat, 1000),
        point: {
          color: color.withAlpha(0.8),
          outlineColor: color.withAlpha(0.35),
          outlineWidth: 2,
          pixelSize: eventPixelSize(event.durationHours),
        },
        properties: {
          kind: 'vessel-event',
          type: event.type,
          vessel: event.vessel,
          flag: event.flag,
          start: event.start,
          end: event.end,
          durationHours: event.durationHours,
          caveat: event.caveat,
        },
      });
    }
    governorRequestRender('vessel-events');
  }

  const layer = {
    id: 'vessel-events',
    name: 'Vessel Events',
    icon: '🛰️',
    source: 'Global Fishing Watch',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('vessel-events');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _enabled = false;
      console.log('[Data:VesselEvents] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      governorRequestRender('vessel-events-enable');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('vessel-events-disable');
    },

    /** Hide during timeline replay — see the same hook on flights.js. */
    setReplaySuppressed(suppressed) {
      if (!_enabled || !_dataSource) return;
      _dataSource.show = !suppressed;
    },

    /** Selectable event types, for UI and voice. */
    getPresets() {
      return VESSEL_EVENT_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        caveat: preset.caveat,
        active: preset.id === state.presetId,
      }));
    },

    /**
     * Switch event type. Refuses anything outside the preset table.
     * @param {string} presetId Preset id.
     * @returns {boolean} True when the type changed.
     */
    setPreset(presetId) {
      if (!resolveVesselEventPreset(presetId) || presetId === state.presetId) return false;
      state.presetId = presetId;
      state.events = [];
      state.count = 0;
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
          state.error = `VESSEL EVENT FEED HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.events)) {
          state.error = 'MALFORMED VESSEL EVENT RESPONSE';
          return false;
        }
        if (payload.preset !== state.presetId) return true;
        state.events = payload.events;
        state.count = payload.events.length;
        state.truncated = payload.truncated === true;
        state.total = Number.isFinite(payload.total) ? payload.total : null;
        state.windowDays = Number.isFinite(payload.windowDays) ? payload.windowDays : 14;
        state.lastUpdate = Date.now();
        state.error = null;
        draw();
        console.log(`[Data:VesselEvents] ${state.count} ${state.presetId}`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'VESSEL EVENT FEED UNAVAILABLE';
        console.warn('[Data:VesselEvents] fetch error:', error);
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

    getAnalystRecords(maxCount = 600) {
      if (!_enabled || !state.events.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 600;
      return state.events.slice(0, limit).map((event) => ({
        id: event.vessel || event.id,
        // Marks this as an inference so a query cannot treat it as a sighting.
        kind: 'apparent-vessel-event',
        lat: event.lat,
        lon: event.lon,
        eventType: event.type,
        vessel: event.vessel,
        flag: event.flag,
        durationHours: event.durationHours,
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
        status: vesselEventsStatusText(state),
        coverage: 'GLOBAL AIS-DERIVED',
      };
    },
  };

  return layer;
}

const vesselEventsLayer = createVesselEventsLayer();

export default vesselEventsLayer;
