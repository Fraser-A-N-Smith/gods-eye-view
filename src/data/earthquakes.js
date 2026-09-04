import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import { finiteOrNull, textOrNull } from './numeric.js';

/**
 * USGS earthquake discs — last 24 hours, M2.5+.
 *
 * Ellipse axes are STATIC (plain numbers), redefined only when a poll brings
 * new data. They must never become a `CallbackProperty` again: every entity
 * here is a `CLAMP_TO_GROUND` ellipse, and a per-frame axis re-tessellates its
 * ground primitive on EVERY frame. Measured on the shipped 58-event feed
 * (2026-08-20 QA hunt, parked camera over SF at 40 km):
 *
 *   58 discs, callback axes → 32.4 ms/frame, 30 fps
 *   58 discs, static axes   →  1.4 ms/frame, 60 fps
 *
 * The former ±15 % radius "pulse" was DROPPED to buy that back: an
 * imperceptible breathing wobble on a translucent ground disc is not worth
 * rebuilding 58 ground primitives 60 times a second. With no per-frame
 * animator left, the layer also no longer holds the render governor
 * continuous — the manager's `layer-tick` / `layer-visibility` requests
 * already cover every discrete mutation this layer makes.
 */

const API_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

/**
 * EMSC (European-Mediterranean Seismological Centre) FDSN event webservice —
 * a supplemental regional source, faster and denser than USGS specifically
 * for Europe/Mediterranean. Fetched directly (no proxy — SeismicPortal is a
 * public webservice), and its failure never affects USGS-backed availability
 * (see `fetchEmscFeatures`, `update`). A candidate that plausibly matches an
 * already-rendered USGS event is dropped (see `isDuplicateEmscEvent`) rather
 * than double-rendered.
 */
const EMSC_API_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query'
  + '?format=json&limit=200&minmag=2.5&orderby=time';

/** Same-event tolerance when checking an EMSC report against the USGS set. */
const EMSC_DEDUP_DISTANCE_KM = 50;
const EMSC_DEDUP_TIME_S = 60;
const EMSC_DEDUP_MAG_DELTA = 0.5;

export const EARTHQUAKE_OVERLAY_SOURCE_ID = 'earthquakes';
export const EARTHQUAKE_OVERLAY_COHORT_LIMIT = 96;
export const EARTHQUAKE_OVERLAY_COLLISION_CAPACITY = 48;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
});

/**
 * Map one SeismicPortal (EMSC) FDSN-event GeoJSON feature to the same record
 * shape used for USGS dedup comparison, or null if the feature has no usable
 * position, magnitude, or timestamp.
 *
 * Field names are a best-effort tolerant mapping against EMSC's published
 * FDSN event webservice format (a `properties` block carrying
 * lon/lat/mag/time/depth/flynn_region, sometimes duplicated in
 * `geometry.coordinates`) — worth re-checking against a live response before
 * relying on this beyond "best-effort regional supplement."
 * @param {object} feature - One FDSN-event GeoJSON feature.
 * @returns {{id:string, lat:number, lon:number, mag:number,
 *   depthKm:number|null, timeMs:number, place:string|null}|null}
 */
export function mapEmscFeature(feature) {
  const p = feature?.properties;
  if (!p) return null;
  const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
  const lat = finiteOrNull(p.lat ?? coords[1]);
  const lon = finiteOrNull(p.lon ?? coords[0]);
  const mag = finiteOrNull(p.mag);
  if (lat === null || lon === null || mag === null) return null;
  // EMSC/FDSN timestamps are ISO 8601 strings — a non-string (e.g. a raw
  // epoch number, which is what USGS uses) is rejected rather than guessed
  // at, since a wrong guess here would corrupt the dedup time check below.
  const rawTime = p.time;
  const timeMs = typeof rawTime === 'string' && !Number.isNaN(Date.parse(rawTime))
    ? Date.parse(rawTime)
    : null;
  if (timeMs === null) return null;
  const depthKm = finiteOrNull(p.depth ?? coords[2]);
  const id = textOrNull(p.unid) || textOrNull(feature?.id) || `emsc:${lat.toFixed(4)},${lon.toFixed(4)}`;
  return { id, lat, lon, mag, depthKm, timeMs, place: textOrNull(p.flynn_region) || textOrNull(p.place) };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * True when `candidate` (an EMSC report) plausibly describes the same
 * physical event as one already in `usgsRecords` — close in space, time, and
 * magnitude. Conservative by design: a false "duplicate" only costs a
 * regional-source label on one event, but a false "distinct" double-renders
 * the same earthquake under two disc entities.
 * @param {{lat:number, lon:number, mag:number, timeMs:number}} candidate
 * @param {Array<{lat:number, lon:number, mag:number, timeMs:number}>} usgsRecords
 * @returns {boolean}
 */
export function isDuplicateEmscEvent(candidate, usgsRecords) {
  if (!Array.isArray(usgsRecords)) return false;
  return usgsRecords.some((u) => (
    haversineKm(u.lat, u.lon, candidate.lat, candidate.lon) <= EMSC_DEDUP_DISTANCE_KM
    && Math.abs(u.timeMs - candidate.timeMs) / 1000 <= EMSC_DEDUP_TIME_S
    && Math.abs(u.mag - candidate.mag) <= EMSC_DEDUP_MAG_DELTA
  ));
}

/**
 * Best-effort EMSC fetch — every failure mode (network error, non-2xx,
 * malformed body) degrades to an empty list rather than throwing, so a
 * SeismicPortal outage or CORS refusal never affects USGS-backed
 * availability. Same independent-degradation shape as DONKI/NeoWs on the
 * space-weather panel.
 * @returns {Promise<Array<object>>} Raw FDSN-event features, or [].
 */
async function fetchEmscFeatures() {
  try {
    const response = await fetch(EMSC_API_URL);
    if (!response.ok) return [];
    const geojson = await response.json();
    return Array.isArray(geojson?.features) ? geojson.features : [];
  } catch {
    return [];
  }
}

/**
 * Color by depth:
 *  - Shallow (<70km): Red
 *  - Intermediate (70-300km): Orange
 *  - Deep (>300km): Yellow
 */
function depthColor(depthKm) {
  if (depthKm < 70) return Cesium.Color.RED;
  if (depthKm < 300) return Cesium.Color.ORANGE;
  return Cesium.Color.YELLOW;
}

/**
 * Build the source-owned presentation for one ambient magnitude label.
 * Magnitude formatting deliberately remains here instead of moving into the
 * shared renderer.
 * @param {object} input
 * @param {string} input.id Stable USGS or deterministic fallback id.
 * @param {Cesium.Cartesian3} input.position Ground anchor shared with the pulse.
 * @param {number} input.magnitude USGS magnitude.
 * @param {string} input.accent Source-owned depth-band color.
 * @returns {object}
 */
export function createEarthquakeOverlayEntry({ id, position, magnitude, accent }) {
  const mag = Number(magnitude);
  return {
    id: String(id),
    position,
    variant: 'label',
    title: `M${mag.toFixed(1)}`,
    accent,
    priority: Math.round(mag * 1000),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep the largest events, with stable identity as the tie-break. */
export function selectEarthquakeOverlayCohort(
  entries,
  limit = EARTHQUAKE_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(0, Math.min(
    EARTHQUAKE_OVERLAY_COHORT_LIMIT,
    Math.floor(Number(limit) || 0),
  ));
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries.slice().sort((a, b) => (
    b.priority - a.priority || String(a.id).localeCompare(String(b.id))
  )).slice(0, cap);
}

/**
 * Map one earthquake's raw plain values to a JSON-safe analyst record
 * (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the USGS event id is absent.
 * @param {Object|null|undefined} raw - Plain values pulled off the entity:
 *   {id, mag, place, time, depth, lat, lon, source}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, magnitude: number|null, depthKm: number|null,
 *   lat: number|null, lon: number|null, timeMs: number|null, place: string|null,
 *   source: string}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `QUAKE-${String(index).padStart(4, '0')}`,
    magnitude: num(raw?.mag),
    depthKm: num(raw?.depth),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: num(raw?.time), // USGS epoch ms
    place: text(raw?.place),
    source: text(raw?.source) || 'USGS',
  };
}

export function createEarthquakesLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
  id: 'earthquakes',
  name: 'Earthquakes (24h)',
  icon: '🌋',
  source: 'USGS',
  updateInterval: 60000,

  init(viewer) {
    _dataSource = new Cesium.CustomDataSource('earthquakes');
    _dataSource.show = false;
    viewer.dataSources.add(_dataSource);
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
    _enabled = false;
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    console.log('[Data:Earthquakes] Initialized');
  },

  enable(viewer) {
    _enabled = true;
    // No continuous-render hold: the discs are static geometry now, so the
    // layer has no per-frame animator to keep the render loop alive for.
    if (_dataSource) _dataSource.show = true;
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true);
  },

  disable(viewer) {
    _enabled = false;
    if (_dataSource) _dataSource.show = false;
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
  },

  async update(viewer) {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        _lastError = `USGS HTTP ${response.status}`;
        console.warn(`[Data:Earthquakes] API returned ${response.status}`);
        return false;
      }

      const geojson = await response.json();
      if (!geojson || !Array.isArray(geojson.features)) {
        _lastError = 'Malformed USGS response';
        return false;
      }

      // EMSC is an optional supplemental regional source — its failure never
      // affects USGS-backed availability (see fetchEmscFeatures).
      const emscFeatures = await fetchEmscFeatures();

      _dataSource.entities.removeAll();
      let count = 0;
      const overlayEntries = [];
      const usgsRecords = []; // Plain {lat, lon, mag, timeMs} — EMSC dedup input.

      for (const feature of geojson.features) {
        const [lon, lat, depthKm] = feature.geometry.coordinates;
        const mag = feature.properties.mag;
        const place = feature.properties.place;
        const time = feature.properties.time;

        if (mag < 2.5) continue; // Skip micro-quakes

        count++;
        usgsRecords.push({ lat, lon, mag, timeMs: time });
        const baseRadius = Math.pow(2, mag) * 1000;
        const color = depthColor(depthKm || 0);
        const isSignificant = mag >= 5.0;
        const fillAlpha = isSignificant ? 0.4 : 0.3;
        const outlineAlpha = isSignificant ? 1.0 : 0.8;

        const position = Cesium.Cartesian3.fromDegrees(lon, lat);
        const stableId = feature.id || `event-${count}`;
        _dataSource.entities.add({
          id: `earthquake:${stableId}`,
          position,
          ellipse: {
            // Static axes — see the module header. A CallbackProperty here
            // re-tessellates the clamped ground geometry every frame.
            semiMajorAxis: baseRadius,
            semiMinorAxis: baseRadius,
            material: new Cesium.ColorMaterialProperty(
              color.withAlpha(fillAlpha)
            ),
            outline: true,
            outlineColor: color.withAlpha(outlineAlpha),
            outlineWidth: isSignificant ? 3 : 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            // Analyst seam (additive): the USGS event id (e.g. "us7000abcd").
            usgsId: feature.id ?? null,
            mag,
            place,
            time,
            depth: depthKm,
            source: 'USGS',
          },
        });
        overlayEntries.push(createEarthquakeOverlayEntry({
          id: String(stableId),
          position,
          magnitude: mag,
          accent: color.toCssColorString(),
        }));
      }

      for (const feature of emscFeatures) {
        const mapped = mapEmscFeature(feature);
        if (!mapped || mapped.mag < 2.5) continue; // Same micro-quake floor as USGS.
        if (isDuplicateEmscEvent(mapped, usgsRecords)) continue;

        count++;
        const baseRadius = Math.pow(2, mapped.mag) * 1000;
        const color = depthColor(mapped.depthKm || 0);
        const isSignificant = mapped.mag >= 5.0;
        const fillAlpha = isSignificant ? 0.4 : 0.3;
        const outlineAlpha = isSignificant ? 1.0 : 0.8;

        const position = Cesium.Cartesian3.fromDegrees(mapped.lon, mapped.lat);
        _dataSource.entities.add({
          id: `earthquake:emsc:${mapped.id}`,
          position,
          ellipse: {
            // Static axes — see the module header. Same perf pin as USGS.
            semiMajorAxis: baseRadius,
            semiMinorAxis: baseRadius,
            material: new Cesium.ColorMaterialProperty(
              color.withAlpha(fillAlpha)
            ),
            outline: true,
            outlineColor: color.withAlpha(outlineAlpha),
            outlineWidth: isSignificant ? 3 : 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: {
            usgsId: mapped.id,
            mag: mapped.mag,
            place: mapped.place,
            time: mapped.timeMs,
            depth: mapped.depthKm,
            source: 'EMSC',
          },
        });
        overlayEntries.push(createEarthquakeOverlayEntry({
          id: `emsc:${mapped.id}`,
          position,
          magnitude: mapped.mag,
          accent: color.toCssColorString(),
        }));
      }

      if (_enabled) {
        overlayHost.setEntries(
          EARTHQUAKE_OVERLAY_SOURCE_ID,
          selectEarthquakeOverlayCohort(overlayEntries),
          {
            cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
            collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
            moving: false,
          },
        );
      }

      _count = count;
      _lastUpdate = Date.now();
      _lastError = null;
      console.log(`[Data:Earthquakes] Updated: ${_count} events (M2.5+)`);
      return true;

    } catch (e) {
      console.warn('[Data:Earthquakes] Fetch error:', e);
      _lastError = 'USGS network error';
      return false;
    }
  },

  destroy(viewer) {
    _enabled = false;
    overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
    overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    if (_dataSource) {
      viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
    }
    _count = 0;
    _lastUpdate = null;
    _lastError = null;
  },

  /**
   * Snapshot the layer's in-memory earthquake records as plain JSON-safe
   * objects for the analyst query engine. On-demand only (called at most
   * once per spoken query) — zero per-frame cost, no listeners, no caching.
   * Returns [] while the layer is disabled or empty.
   * @param {number} [maxCount=2000] - Maximum records to return (truncation).
   * @returns {Array<Object>} See mapAnalystRecord for the record shape.
   */
  getAnalystRecords(maxCount = 2000) {
    if (!_dataSource || !_dataSource.show) return [];
    const entities = _dataSource.entities.values;
    if (!entities.length) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    const now = Cesium.JulianDate.now();
    const result = [];
    for (const entity of entities) {
      if (result.length >= limit) break;
      const cartesian = entity.position ? entity.position.getValue(now) : null;
      const carto = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
      const p = entity.properties;
      result.push(mapAnalystRecord({
        id: p?.usgsId?.getValue(now) ?? null,
        mag: p?.mag?.getValue(now),
        place: p?.place?.getValue(now),
        time: p?.time?.getValue(now),
        depth: p?.depth?.getValue(now),
        source: p?.source?.getValue(now),
        lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
        lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
      }, result.length));
    }
    return result;
  },

  getStats() {
    return {
      count: _count,
      lastUpdate: _lastUpdate,
      error: _lastError,
    };
  },
  };
  return layer;
}

const earthquakesLayer = createEarthquakesLayer();

export default earthquakesLayer;
