/**
 * @module data/firePerimeters
 * @description Mapped wildfire perimeters — the burned edge, not the hotspot.
 *
 * The app already carries NASA FIRMS, which plots satellite detections: pixels
 * that were hot at an overpass. This layer plots the other half of the
 * picture — the perimeters interagency crews have actually mapped. A cluster
 * of hotspots says something is burning; a perimeter says what is inside it,
 * how large it is, and how much of its edge is contained.
 *
 * Data comes from NIFC's WFIGS interagency perimeter service via the cached
 * `/api/fire-perimeters` proxy, which does the normalization and geometry
 * simplification server-side (see firePerimetersShape.js).
 *
 * ## What this layer is careful not to imply
 *
 * - **Coverage is US interagency, not global.** A country with no perimeters
 *   drawn is a country this source does not map, not a country that is not
 *   burning. The stats string says so.
 * - **Perimeters lag the fire.** They are remapped in hours; the fire moves in
 *   minutes. The card shows the mapping's own timestamp rather than "now".
 * - **The outline is the outer edge.** Unburned islands inside a perimeter are
 *   dropped by the simplifier, and a record that had them says so.
 * - **A truncated set never presents as complete.** When the bound binds, the
 *   layer reports the real upstream count alongside what it drew.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

const API_URL = '/api/fire-perimeters';

/** Refresh cadence. Perimeters are remapped in hours; the proxy caches 15 min. */
const UPDATE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Fill and outline by containment. Containment is the operationally meaningful
 * number on a perimeter — an uncontained edge is where the fire can still
 * grow — so it drives the colour rather than size doing it.
 */
export function containmentStyle(containedPct) {
  if (!Number.isFinite(containedPct)) {
    // Unknown containment gets its own neutral colour. Painting it as
    // uncontained would be a claim; painting it as contained would be worse.
    return { css: '#9aa7b4', label: 'CONTAINMENT UNKNOWN' };
  }
  if (containedPct >= 90) return { css: '#4ade80', label: `${Math.round(containedPct)}% CONTAINED` };
  if (containedPct >= 50) return { css: '#ffd23f', label: `${Math.round(containedPct)}% CONTAINED` };
  if (containedPct >= 20) return { css: '#ff9838', label: `${Math.round(containedPct)}% CONTAINED` };
  return { css: '#ff4d3d', label: `${Math.round(containedPct)}% CONTAINED` };
}

/** Compact acreage label. */
export function formatAcres(acres) {
  if (!Number.isFinite(acres)) return 'SIZE UNKNOWN';
  if (acres >= 1_000_000) return `${(acres / 1_000_000).toFixed(2)}M ACRES`;
  if (acres >= 1000) return `${Math.round(acres / 1000)}K ACRES`;
  return `${Math.round(acres)} ACRES`;
}

/**
 * Ring centroid, for label placement and analyst records.
 *
 * A plain vertex mean, not a true area centroid: perimeter vertices are
 * distributed along the edge, so this lands inside the fire for the convex
 * shapes that dominate, and it is only ever used to place a label and answer
 * "roughly where is this fire" — never as a reported position of anything.
 *
 * @param {Array<Array<number>>} ring Coordinate ring.
 * @returns {{lon:number, lat:number}|null}
 */
export function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const point of ring) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    lon += point[0];
    lat += point[1];
    count += 1;
  }
  if (count === 0) return null;
  return { lon: lon / count, lat: lat / count };
}

/**
 * Build the honest one-line coverage/status string for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function perimeterStatusText(state) {
  if (state.error) return state.error;
  if (state.loading) return 'LOADING PERIMETERS';
  if (state.count === 0) return 'NO MAPPED PERIMETERS';
  const parts = [`${state.count} PERIMETERS`];
  if (state.truncated && Number.isFinite(state.totalFeatures)) {
    parts.push(`OF ${state.totalFeatures} — LARGEST SHOWN`);
  }
  parts.push('US INTERAGENCY COVERAGE');
  return parts.join(' · ');
}

export function createFirePerimetersLayer({ fetchImpl = null } = {}) {
  let _dataSource = null;
  let _enabled = false;
  let _abort = null;
  const state = {
    count: 0,
    totalFeatures: null,
    truncated: false,
    loading: false,
    error: null,
    lastUpdate: null,
    attribution: null,
    perimeters: [],
  };

  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function clearEntities() {
    if (_dataSource) _dataSource.entities.removeAll();
    state.perimeters = [];
    state.count = 0;
  }

  function draw(perimeters) {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    for (const perimeter of perimeters) {
      const style = containmentStyle(perimeter.containedPct);
      const color = Cesium.Color.fromCssColorString(style.css);
      for (let index = 0; index < perimeter.rings.length; index += 1) {
        const ring = perimeter.rings[index];
        const positions = Cesium.Cartesian3.fromDegreesArray(ring.flat());
        _dataSource.entities.add({
          id: `fire-perimeter-${perimeter.id}-${index}`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: color.withAlpha(0.22),
            outline: true,
            outlineColor: color.withAlpha(0.95),
            outlineWidth: 2,
            // BOTH so the perimeter drapes on the photoreal 3D tiles and on
            // the terrain of the globe stacks alike — a fire outline that
            // vanished when the basemap changed would be a bug, not a feature.
            classificationType: Cesium.ClassificationType.BOTH,
          },
          properties: {
            kind: 'fire-perimeter',
            name: perimeter.name,
            acres: perimeter.acres,
            containedPct: perimeter.containedPct,
            containmentLabel: style.label,
            acresLabel: formatAcres(perimeter.acres),
            discoveredAt: perimeter.discoveredAt,
            state: perimeter.state,
            cause: perimeter.cause,
            // Surfaced so a card can say the outline is the outer edge only.
            outerEdgeOnly: perimeter.hasHoles === true,
          },
        });
      }
    }
    state.perimeters = perimeters;
    state.count = perimeters.length;
    governorRequestRender('fire-perimeters');
  }

  const layer = {
    id: 'fire-perimeters',
    name: 'Fire Perimeters',
    icon: '🔥',
    source: 'NIFC / WFIGS',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('fire-perimeters');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _enabled = false;
      console.log('[Data:FirePerimeters] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      governorRequestRender('fire-perimeters-enable');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('fire-perimeters-disable');
    },

    /**
     * Hide or restore rendering during timeline replay. Perimeters change on
     * an hours-long cadence, so the buffer has nothing meaningful to replay
     * for them — but leaving them lit over a reconstructed past would imply
     * the outline was observed at that moment. See flights.js for the hook.
     * @param {boolean} suppressed True while a replay frame owns the globe.
     */
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
          state.error = `PERIMETER FEED HTTP ${response.status}`;
          // Existing perimeters are KEPT — last-good beats a wiped map, and
          // the chip still reports the failure.
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.perimeters)) {
          state.error = 'MALFORMED PERIMETER RESPONSE';
          return false;
        }
        draw(payload.perimeters);
        state.truncated = payload.truncated === true;
        state.totalFeatures = Number.isFinite(payload.totalFeatures) ? payload.totalFeatures : null;
        state.attribution = payload.attribution || null;
        state.lastUpdate = Date.now();
        state.error = null;
        console.log(`[Data:FirePerimeters] ${state.count} perimeters`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'PERIMETER FEED UNAVAILABLE';
        console.warn('[Data:FirePerimeters] fetch error:', error);
        return false;
      } finally {
        state.loading = false;
        _abort = null;
      }
    },

    destroy(viewer) {
      _enabled = false;
      clearEntities();
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      state.lastUpdate = null;
      state.error = null;
      state.truncated = false;
      state.totalFeatures = null;
    },

    /**
     * Analyst records for voice queries and the timeline buffer. A perimeter
     * is an area, so the reported position is its centroid — flagged as such
     * via `kind`, because it is a label anchor, not a measured location.
     * @param {number} [maxCount]
     * @returns {Array<object>}
     */
    getAnalystRecords(maxCount = 500) {
      if (!_enabled || !state.perimeters.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 500;
      const records = [];
      for (const perimeter of state.perimeters) {
        if (records.length >= limit) break;
        const centre = ringCentroid(perimeter.rings[0]);
        if (!centre) continue;
        records.push({
          id: perimeter.name,
          kind: 'perimeter-centroid',
          lat: centre.lat,
          lon: centre.lon,
          acres: perimeter.acres,
          containedPct: perimeter.containedPct,
          name: perimeter.name,
          state: perimeter.state,
        });
      }
      return records;
    },

    getStats() {
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        error: state.error,
        loading: state.loading,
        truncated: state.truncated,
        totalFeatures: state.totalFeatures,
        coverage: 'US INTERAGENCY',
        status: perimeterStatusText(state),
      };
    },
  };

  return layer;
}

const firePerimetersLayer = createFirePerimetersLayer();

export default firePerimetersLayer;
