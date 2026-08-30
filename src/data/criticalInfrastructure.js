import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { mapOverpassElement } from './criticalInfrastructureShape.js';

/**
 * Critical Infrastructure — OpenStreetMap power plants (`power=plant`) and
 * hospitals (`amenity=hospital`), fetched through the server-side
 * `/api/critical-infrastructure` proxy.
 *
 * VIEWPORT-SCOPED, not globally polled: OSM lists hundreds of thousands of
 * hospitals and tens of thousands of power plants worldwide, so this layer
 * follows `militaryInstallations.js`'s structural pattern rather than the
 * fixed-timer pattern most other layers in this app use — it fetches only a
 * bounded bbox around the current camera view and refetches on
 * `viewer.camera.moveEnd`, debounced, with the previous in-flight request
 * aborted. The proxy snaps the requested bbox outward onto a shared cache
 * grid, so the response is a SUPERSET of the viewport; `withinViewport`
 * below trims it back down before anything reaches the map. A response that
 * hit the proxy's element cap (SATURATED) triggers one exact-viewport
 * re-ask, mirroring `militaryInstallations.js`'s saturated/exact retry.
 *
 * The proxy does the Overpass fetch AND the tag/coordinate mapping — via the
 * SAME `mapOverpassElement` re-exported below (see
 * `criticalInfrastructureShape.js`) — so this layer never re-implements that
 * mapping against raw Overpass JSON; it only places the already-mapped
 * `{id, kind, name, lat, lon}` records it receives.
 *
 * Each facility renders as a static point (no `Cesium.CallbackProperty`, no
 * continuous render hold): power plants orange, hospitals a white point with
 * a small red cross label.
 */

const API_URL = '/api/critical-infrastructure';
const LAYER_ID = 'critical-infrastructure';
const REQUEST_DEBOUNCE_MS = 500;
const MAX_VIEWPORT_DEGREES = 10;

const KIND_COLOR = {
  'power-plant': '#ff9d2e',
  hospital: '#ffffff',
};

export { mapOverpassElement };

/**
 * Whether a response was truncated at the upstream element cap.
 *
 * Mirrors `installationResponseSaturated` in `militaryInstallations.js`: the
 * proxy states this outright, but a `saturated`-less payload is not evidence
 * of a complete answer (a disk entry cached before the field shipped could
 * still be live), so fall back to deriving it from the element count against
 * the cap the payload itself reports.
 * @param {{saturated?: boolean, elements?: Array, elementCap?: number}} payload
 * @returns {boolean}
 */
export function responseSaturated(payload) {
  if (typeof payload?.saturated === 'boolean') return payload.saturated;
  const cap = Number(payload?.elementCap);
  if (!Number.isFinite(cap) || cap <= 0) return false;
  return Array.isArray(payload?.elements) && payload.elements.length >= cap;
}

/**
 * Whether a mapped record's point falls inside the REQUESTED viewport.
 *
 * The proxy snaps the request bbox outward onto a shared cache grid, so a
 * response is a superset of what was asked for; every record here is a point
 * (never a footprint), so an exact containment test loses nothing.
 * @param {{lat:number, lon:number}} record
 * @param {{south:number, west:number, north:number, east:number}} box
 * @returns {boolean}
 */
export function withinViewport(record, box) {
  if (!record || !box) return false;
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return false;
  return record.lat >= box.south && record.lat <= box.north
    && record.lon >= box.west && record.lon <= box.east;
}

/**
 * Map one facility's raw plain values to a JSON-safe analyst record (analyst
 * query engine seam). Pure — no Cesium types. Missing/unknown fields are
 * null, never NaN/undefined. Falls back to an index-based id when the
 * upstream id is absent.
 * @param {Object|null|undefined} raw - Plain values: {id, kind, name, lat, lon}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, kind: string|null, name: string|null, lat: number|null, lon: number|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `CRITICAL-INFRA-${String(index).padStart(4, '0')}`,
    kind: text(raw?.kind),
    name: text(raw?.name),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
  };
}

const state = {
  viewer: null,
  dataSource: null,
  enabled: false,
  records: [],
  lastUpdate: null,
  error: null,
  status: 'idle',
  stale: false,
  /** Whether the upstream truncated at its element cap for the current view. */
  saturated: false,
  loading: false,
  abort: null,
  moveEndRemove: null,
  timer: null,
};

/**
 * Commit a status/error transition and buy the one frame it needs.
 *
 * With the render governor idle, no frame would otherwise arrive to re-read
 * this, so a load that fails after the scene went quiet would leave the last
 * healthy readout on screen indefinitely (the same reasoning
 * `militaryInstallations.js`'s `setInstallationStatus` documents).
 * @param {string} status @param {?string} error
 */
function setStatus(status, error = null) {
  if (state.status === status && state.error === error) return;
  state.status = status;
  state.error = error;
  governorRequestRender('critical-infrastructure-status');
}

function viewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  // Cross-dateline/global views require a zoom before a bounded request.
  if (!Number.isFinite(south + north + west + east) || east <= west || north - south > MAX_VIEWPORT_DEGREES || east - west > MAX_VIEWPORT_DEGREES) return null;
  return { south, west, north, east };
}

function clearRendered() {
  if (state.dataSource?.entities) state.dataSource.entities.removeAll();
}

function renderRecords() {
  governorRequestRender('critical-infrastructure-render');
  clearRendered();
  for (const record of state.records) {
    const isHospital = record.kind === 'hospital';
    const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
    state.dataSource.entities.add({
      id: `critical-infrastructure:${record.id}`,
      position,
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString(KIND_COLOR[record.kind] || KIND_COLOR['power-plant']),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: isHospital ? {
        text: '✚', // heavy Greek cross
        font: 'bold 13px sans-serif',
        fillColor: Cesium.Color.RED,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      properties: {
        recordId: record.id,
        kind: record.kind,
        name: record.name,
      },
    });
  }
}

function scheduleLoad() {
  if (!state.enabled) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => { loadCriticalInfrastructure(); }, REQUEST_DEBOUNCE_MS);
}

async function loadCriticalInfrastructure() {
  if (!state.enabled || !state.viewer) return;
  const box = viewportBox(state.viewer);
  if (!box) {
    state.abort?.abort();
    state.abort = null;
    state.loading = false;
    setStatus('zoom-in', 'Zoom in to load critical infrastructure');
    return;
  }
  state.abort?.abort();
  const requestAbort = new AbortController();
  state.abort = requestAbort;
  state.loading = true;
  try {
    const fetchInfrastructure = async (exact) => {
      const query = new URLSearchParams(Object.entries(box).map(([key, value]) => [key, value.toFixed(5)]));
      if (exact) query.set('exact', '1');
      const response = await fetch(`${API_URL}?${query}`, { signal: requestAbort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || `Critical infrastructure HTTP ${response.status}`);
      return body;
    };

    let payload = await fetchInfrastructure(false);
    // A SATURATED snapped tile was truncated upstream, so features from the
    // snap's extra ring may have crowded out sites actually on screen. Re-ask
    // for the exact viewport (separately keyed and cached) before rendering.
    let saturated = responseSaturated(payload);
    if (saturated) {
      payload = await fetchInfrastructure(true);
      saturated = responseSaturated(payload);
    }
    if (requestAbort.signal.aborted || state.abort !== requestAbort || !state.enabled) return;

    const rawRecords = Array.isArray(payload?.elements) ? payload.elements : [];
    // The proxy answers a bbox at least as large as the viewport; keep only
    // what was actually asked for so nothing off-screen reaches the map.
    const records = rawRecords.filter((record) => withinViewport(record, box));

    state.records = records;
    state.lastUpdate = Date.now();
    state.stale = payload.status === 'stale';
    // Even the exact-viewport retry can saturate in a dense area. Say so
    // rather than implying the view is completely surveyed.
    state.saturated = saturated;
    setStatus(
      state.records.length ? (state.stale ? 'stale' : 'ready') : 'empty',
      payload.status === 'stale'
        ? 'Serving cached critical infrastructure'
        : (saturated ? 'Too many facilities in view to list them all' : null),
    );
    renderRecords();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setStatus('unavailable', error?.message || 'Critical infrastructure unavailable');
  } finally {
    // An older aborted request must not clear a newer request's busy state.
    if (state.abort === requestAbort) {
      state.abort = null;
      state.loading = false;
    }
  }
}

const criticalInfrastructureLayer = {
  id: LAYER_ID,
  name: 'Critical Infrastructure (Power & Hospitals)',
  icon: '🏭',
  source: 'OpenStreetMap (Overpass API)',
  updateInterval: 0,
  statsRefreshInterval: 1000,
  init(viewer) {
    state.viewer = viewer;
    state.dataSource = new Cesium.CustomDataSource(LAYER_ID);
    state.dataSource.show = false;
    viewer.dataSources.add(state.dataSource);
    state.moveEndRemove = viewer.camera.moveEnd.addEventListener(scheduleLoad);
  },
  enable() {
    state.enabled = true;
    if (state.dataSource) state.dataSource.show = true;
    // DataLayerManager invokes update() immediately after enable(), which owns
    // the first fetch. Avoid racing it with a second aborting request here.
  },
  disable() {
    state.enabled = false;
    clearTimeout(state.timer);
    state.abort?.abort();
    state.abort = null;
    state.loading = false;
    if (state.dataSource) state.dataSource.show = false;
  },
  update() { return loadCriticalInfrastructure(); },
  destroy(viewer) {
    this.disable();
    state.moveEndRemove?.();
    state.moveEndRemove = null;
    clearRendered();
    if (state.dataSource && viewer) viewer.dataSources.remove(state.dataSource, true);
    state.dataSource = null;
    state.records = [];
    state.lastUpdate = null;
    state.error = null;
    state.status = 'idle';
    state.stale = false;
    state.saturated = false;
  },
  /**
   * Snapshot the layer's in-memory facility records as plain JSON-safe
   * objects for the analyst query engine. On-demand only, zero per-frame
   * cost. Returns [] while the layer is disabled or empty.
   * @param {number} [maxCount=2000] - Maximum records to return (truncation).
   * @returns {Array<Object>} See mapAnalystRecord for the record shape.
   */
  getAnalystRecords(maxCount = 2000) {
    if (!state.dataSource || !state.dataSource.show) return [];
    if (!state.records.length) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
    return state.records.slice(0, limit).map((record, index) => mapAnalystRecord(record, index));
  },
  getStats() {
    return {
      count: state.records.length,
      lastUpdate: state.lastUpdate,
      stale: state.stale,
      saturated: state.saturated,
      error: state.error,
      status: state.status,
      loading: state.loading,
      loadingLabel: state.loading ? 'loading critical infrastructure' : '',
    };
  },
};

export default criticalInfrastructureLayer;
