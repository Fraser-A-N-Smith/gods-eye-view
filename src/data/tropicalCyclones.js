/**
 * @module data/tropicalCyclones
 * @description Active tropical cyclones from the National Hurricane Center.
 *
 * Renders each active system at its last advisory position, sized and coloured
 * by Saffir–Simpson category, with intensity, pressure and movement on the
 * card.
 *
 * ## Position is an advisory fix, not a live track
 *
 * NHC issues advisories on a fixed schedule (every 3 hours for position
 * updates, 6 for full advisories). A storm marker is therefore up to a few
 * hours old and the system has moved since. The layer reports the advisory
 * timestamp rather than implying a live position, and the marker is drawn as a
 * point rather than a track for the same reason: interpolating a hurricane
 * between advisories would be inventing a path.
 *
 * ## The forecast cone is deliberately absent for now
 *
 * The cone of uncertainty lives in NHC's separate GIS products, whose service
 * layer indices could not be verified when this layer was written. Drawing a
 * guessed cone would be far worse than drawing none — the cone is the single
 * most misread graphic in weather communication, and a wrong one is actively
 * dangerous. The storm position is real and useful on its own; the cone is a
 * follow-up that needs the GIS endpoints confirmed first.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { cycloneCategory } from './weatherAlertsShape.js';

const API_URL = '/api/tropical-cyclones';
const UPDATE_INTERVAL_MS = 10 * 60 * 1000;

/** Marker pixel size by category rank. */
export function cyclonePixelSize(rank) {
  if (!Number.isFinite(rank) || rank < 0) return 10;
  return 12 + rank * 4;
}

/**
 * Honest one-line status for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function cyclonesStatusText(state) {
  if (state.error) return state.error;
  if (state.loading) return 'LOADING CYCLONES';
  if (state.count === 0) return 'NO ACTIVE CYCLONES · NHC BASINS';
  const strongest = state.strongest ? ` · STRONGEST ${state.strongest}` : '';
  return `${state.count} ACTIVE${strongest} · ADVISORY POSITIONS, NOT LIVE TRACK`;
}

export function createTropicalCyclonesLayer({ fetchImpl = null } = {}) {
  let _dataSource = null;
  let _enabled = false;
  let _abort = null;
  const state = {
    count: 0,
    strongest: null,
    loading: false,
    error: null,
    lastUpdate: null,
    storms: [],
  };

  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function draw() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    for (const storm of state.storms) {
      const band = cycloneCategory(storm.windKt);
      const color = Cesium.Color.fromCssColorString(band.css);
      _dataSource.entities.add({
        id: `cyclone-${storm.id}`,
        position: Cesium.Cartesian3.fromDegrees(storm.lon, storm.lat, 5000),
        point: {
          color: color.withAlpha(0.85),
          outlineColor: color.withAlpha(0.4),
          outlineWidth: 3,
          pixelSize: cyclonePixelSize(band.rank),
        },
        label: {
          text: `${storm.name} · ${band.category}`,
          font: '600 12px "JetBrains Mono", monospace',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          kind: 'tropical-cyclone',
          name: storm.name,
          category: band.category,
          windKt: storm.windKt,
          pressureMb: storm.pressureMb,
          basin: storm.basin,
          // Surfaced so a card can date the fix rather than implying "now".
          advisoryAt: storm.lastUpdate,
        },
      });
    }
    governorRequestRender('tropical-cyclones');
  }

  const layer = {
    id: 'tropical-cyclones',
    name: 'Tropical Cyclones',
    icon: '🌀',
    source: 'NOAA NHC',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('tropical-cyclones');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _enabled = false;
      console.log('[Data:TropicalCyclones] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      governorRequestRender('cyclones-enable');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('cyclones-disable');
    },

    /** Hide during timeline replay — see the same hook on flights.js. */
    setReplaySuppressed(suppressed) {
      if (!_enabled || !_dataSource) return;
      _dataSource.show = !suppressed;
    },

    async update() {
      if (!_enabled) return true;
      state.loading = true;
      _abort = new AbortController();
      try {
        const response = await doFetch(API_URL, { signal: _abort.signal });
        if (!response.ok) {
          state.error = `CYCLONE FEED HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.storms)) {
          state.error = 'MALFORMED CYCLONE RESPONSE';
          return false;
        }
        state.storms = payload.storms;
        state.count = payload.storms.length;
        state.strongest = payload.storms.length
          ? cycloneCategory(payload.storms[0].windKt).category
          : null;
        state.lastUpdate = Date.now();
        state.error = null;
        draw();
        console.log(`[Data:TropicalCyclones] ${state.count} active`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'CYCLONE FEED UNAVAILABLE';
        console.warn('[Data:TropicalCyclones] fetch error:', error);
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
      state.storms = [];
      state.count = 0;
      state.lastUpdate = null;
      state.error = null;
    },

    getAnalystRecords(maxCount = 100) {
      if (!_enabled || !state.storms.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 100;
      return state.storms.slice(0, limit).map((storm) => ({
        id: storm.name,
        kind: 'cyclone-advisory-fix',
        lat: storm.lat,
        lon: storm.lon,
        name: storm.name,
        windKt: storm.windKt,
        pressureMb: storm.pressureMb,
        category: cycloneCategory(storm.windKt).category,
        basin: storm.basin,
      }));
    },

    getStats() {
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        error: state.error,
        loading: state.loading,
        coverage: 'NHC BASINS',
        status: cyclonesStatusText(state),
      };
    },
  };

  return layer;
}

const tropicalCyclonesLayer = createTropicalCyclonesLayer();

export default tropicalCyclonesLayer;
