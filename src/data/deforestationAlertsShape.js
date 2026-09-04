/**
 * @module data/deforestationAlertsShape
 * @description Normalization for Global Forest Watch GLAD-L (Landsat)
 * deforestation alerts — a new "human footprint" event category alongside
 * the bundled Datacenters/Dams infrastructure layers.
 *
 * Pure module shared by the `/api/deforestation-alerts` proxy
 * (vite.config.js, Node-only) and the Cesium-importing layer
 * (deforestationAlerts.js, browser-only) — mirroring the existing
 * `criticalInfrastructureShape.js` precedent.
 *
 * ⚠️ GFW's Data API's exact column-name spelling for this dataset could not
 * be verified against a live response while writing this (sandboxed network
 * access) — several candidate spellings are checked for date/confidence
 * below, worth re-checking against a live payload. `latitude`/`longitude`
 * are the one part of this shape that is a stable, well-documented GFW
 * convention, not a guess.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/**
 * Map one raw GLAD-L alert row to a placeable record, or null if it has no
 * usable position.
 * @param {object} raw - One row of the upstream query response.
 * @returns {{id:string, lat:number, lon:number, alertDate:string|null,
 *   confidence:string|null}|null}
 */
export function mapGfwAlert(raw) {
  const lat = finiteOrNull(raw?.latitude ?? raw?.lat);
  const lon = finiteOrNull(raw?.longitude ?? raw?.lon);
  if (lat === null || lon === null) return null;
  const rawDate = raw?.umd_glad_landsat_alerts__date ?? raw?.alert__date ?? raw?.alert_date ?? raw?.date;
  const alertDate = typeof rawDate === 'string' && !Number.isNaN(Date.parse(rawDate))
    ? new Date(rawDate).toISOString()
    : null;
  const confidence = textOrNull(
    raw?.umd_glad_landsat_alerts__confidence ?? raw?.alert__confidence ?? raw?.confidence,
  );
  return {
    id: `gfw:${lat.toFixed(5)},${lon.toFixed(5)}:${alertDate || 'undated'}`,
    lat,
    lon,
    alertDate,
    confidence,
  };
}

/**
 * Map the full upstream query response into an array of normalized alert
 * records, dropping unusable rows.
 * @param {object} payload - Parsed JSON body of the upstream response.
 * @param {number} [maxCount=1500] - Cap on returned records.
 * @returns {Array<object>} See `mapGfwAlert` for the record shape.
 */
export function mapGfwAlertFeed(payload, maxCount = 1500) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const out = [];
  for (const row of rows) {
    const mapped = mapGfwAlert(row);
    if (mapped) out.push(mapped);
    if (out.length >= maxCount) break;
  }
  return out;
}
