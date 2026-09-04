import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { mapGfwAlert } from './deforestationAlertsShape.js';

/**
 * Deforestation Alerts — Global Forest Watch GLAD-L (Landsat) tree-cover-loss
 * detections, fetched through the server-side `/api/deforestation-alerts`
 * proxy.
 *
 * VIEWPORT-SCOPED, not globally polled: global alert volume is far too dense
 * to preload (millions of detections/year concentrated in the tropics), so
 * this layer follows `criticalInfrastructure.js`'s structural pattern — it
 * fetches only a bounded bbox around the current camera view and refetches
 * on `viewer.camera.moveEnd`, debounced, with the previous in-flight request
 * aborted.
 *
 * BYOK: Global Forest Watch's Data API requires a free registered token.
 * Without `FOREST_WATCH_API_TOKEN` set server-side (deliberately NOT
 * `GFW_API_TOKEN`, which this app already uses for the unrelated Global
 * Fishing Watch vessel-events layer), the proxy returns 503 and this layer
 * reports `KEY REQUIRED` rather than an error — same `no_key` shape as
 * `firmsHeatmap.js`.
 *
 * ⚠️ GFW's Data API's exact query mechanism and column names are a
 * best-effort mapping (see `deforestationAlertsShape.js`'s doc comment) —
 * worth re-checking against a live response.
 *
 * Each alert renders as a small point, age-tinted: recent alerts (last 30
 * days) read hot, older ones fade toward the truncation window.
 */

const API_URL = '/api/deforestation-alerts';
const LAYER_ID = 'deforestation-alerts';
const REQUEST_DEBOUNCE_MS = 500;
const MAX_VIEWPORT_DEGREES = 5;

export { mapGfwAlert };

/**
 * Whether a mapped record's point falls inside the REQUESTED viewport.
 *
 * The proxy snaps the request bbox outward onto a shared cache grid, so a
 * response is a superset of what was asked for (same reasoning as
 * `criticalInfrastructure.js`'s `withinViewport`); every record here is a
 * point, so an exact containment test loses nothing.
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

/** Age-tint: recent is red, aging through orange/yellow, oldest is a dim gray. */
function ageStyle(alertDate) {
  const ms = typeof alertDate === 'string' ? Date.parse(alertDate) : NaN;
  const ageDays = Number.isFinite(ms) ? (Date.now() - ms) / 86_400_000 : Infinity;
  if (ageDays <= 30) return Cesium.Color.RED;
  if (ageDays <= 90) return Cesium.Color.ORANGE;
  if (ageDays <= 180) return Cesium.Color.YELLOW;
  return Cesium.Color.GRAY;
}

/**
 * Map one alert's raw plain values to a JSON-safe analyst record (analyst
 * query engine seam). Pure — no Cesium types. Missing/unknown fields are
 * null, never NaN/undefined. Falls back to an index-based id when the
 * upstream id is absent.
 * @param {Object|null|undefined} raw - Plain values: {id, lat, lon, alertDate, confidence}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, lat: number|null, lon: number|null,
 *   alertDate: string|null, confidence: string|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `DEFOREST-${String(index).padStart(4, '0')}`,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    alertDate: text(raw?.alertDate),
    confidence: text(raw?.confidence),
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
  keyRequired: false,
  truncated: false,
  loading: false,
  abort: null,
  moveEndRemove: null,
  timer: null,
};

function setStatus(status, error = null) {
  if (state.status === status && state.error === error) return;
  state.status = status;
  state.error = error;
  governorRequestRender('deforestation-alerts-status');
}

function viewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (!Number.isFinite(south + north + west + east) || east <= west || north - south > MAX_VIEWPORT_DEGREES || east - west > MAX_VIEWPORT_DEGREES) return null;
  return { south, west, north, east };
}

function clearRendered() {
  if (state.dataSource?.entities) state.dataSource.entities.removeAll();
}

function renderRecords() {
  governorRequestRender('deforestation-alerts-render');
  clearRendered();
  for (const record of state.records) {
    const position = Cesium.Cartesian3.fromDegrees(record.lon, record.lat);
    state.dataSource.entities.add({
      id: `deforestation-alert:${record.id}`,
      position,
      point: {
        pixelSize: 5,
        color: ageStyle(record.alertDate),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: {
        alertId: record.id,
        alertDate: record.alertDate,
        confidence: record.confidence,
      },
    });
  }
}

function scheduleLoad() {
  if (!state.enabled) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => { loadDeforestationAlerts(); }, REQUEST_DEBOUNCE_MS);
}

async function loadDeforestationAlerts() {
  if (!state.enabled || !state.viewer) return;
  const box = viewportBox(state.viewer);
  if (!box) {
    state.abort?.abort();
    state.abort = null;
    state.loading = false;
    setStatus('zoom-in', 'Zoom in to load deforestation alerts');
    return;
  }
  state.abort?.abort();
  const requestAbort = new AbortController();
  state.abort = requestAbort;
  state.loading = true;
  try {
    const query = new URLSearchParams(Object.entries(box).map(([key, value]) => [key, value.toFixed(5)]));
    const response = await fetch(`${API_URL}?${query}`, { signal: requestAbort.signal });
    if (requestAbort.signal.aborted || state.abort !== requestAbort || !state.enabled) return;
    if (response.status === 503) {
      const body = await response.json().catch(() => null);
      if (body?.error === 'no_key') {
        state.keyRequired = true;
        state.records = [];
        clearRendered();
        setStatus('key-required', 'GFW_API_TOKEN not configured');
        return;
      }
    }
    if (!response.ok) throw new Error(`Deforestation alerts HTTP ${response.status}`);
    const payload = await response.json();
    const rawRecords = Array.isArray(payload?.alerts) ? payload.alerts : [];
    // The proxy answers a bbox at least as large as the viewport (snapped
    // onto a shared cache grid); keep only what was actually asked for so
    // nothing off-screen reaches the map.
    const records = rawRecords.filter((record) => withinViewport(record, box));

    state.keyRequired = false;
    state.records = records;
    state.lastUpdate = Date.now();
    state.truncated = payload.truncated === true;
    setStatus(
      state.records.length ? 'ready' : 'empty',
      state.truncated ? 'Too many alerts in view to list them all' : null,
    );
    renderRecords();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setStatus('unavailable', error?.message || 'Deforestation alerts unavailable');
  } finally {
    if (state.abort === requestAbort) {
      state.abort = null;
      state.loading = false;
    }
  }
}

const deforestationAlertsLayer = {
  id: LAYER_ID,
  name: 'Deforestation Alerts (GFW)',
  icon: '🪓',
  source: 'Global Forest Watch (GLAD-L)',
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
  },
  disable() {
    state.enabled = false;
    clearTimeout(state.timer);
    state.abort?.abort();
    state.abort = null;
    state.loading = false;
    if (state.dataSource) state.dataSource.show = false;
  },
  update() { return loadDeforestationAlerts(); },
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
    state.keyRequired = false;
    state.truncated = false;
  },
  /**
   * Snapshot the layer's in-memory alert records as plain JSON-safe objects
   * for the analyst query engine. On-demand only, zero per-frame cost.
   * Returns [] while the layer is disabled or empty.
   * @param {number} [maxCount=1500] - Maximum records to return (truncation).
   * @returns {Array<Object>} See mapAnalystRecord for the record shape.
   */
  getAnalystRecords(maxCount = 1500) {
    if (!state.dataSource || !state.dataSource.show) return [];
    if (!state.records.length) return [];
    const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 1500;
    return state.records.slice(0, limit).map((record, index) => mapAnalystRecord(record, index));
  },
  getStats() {
    return {
      count: state.records.length,
      lastUpdate: state.lastUpdate,
      truncated: state.truncated,
      keyRequired: state.keyRequired,
      error: state.error,
      status: state.status,
      loading: state.loading,
      loadingLabel: state.loading ? 'loading deforestation alerts' : '',
    };
  },
};

export default deforestationAlertsLayer;
