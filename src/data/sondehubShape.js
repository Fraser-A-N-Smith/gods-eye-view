/**
 * @module data/sondehubShape
 * @description Normalization for the SondeHub Tracker real-time telemetry
 * feed — live weather-balloon (radiosonde) positions.
 *
 * Pure module shared by the `/api/sondehub` proxy (vite.config.js, Node-only)
 * and the Cesium-importing layer (sondehub.js, browser-only) — mirroring the
 * existing `spaceWeatherShape.js` / `globalHazardsShape.js` / `volcanoesShape.js`
 * precedent so the server and the client run the SAME mapping implementation.
 *
 * SondeHub's `/sondes/telemetry` endpoint returns an object keyed by sonde
 * serial number, each value the most recent telemetry point for that sonde
 * (only currently-transmitting sondes appear — most sondes fly for roughly
 * two hours before landing, so the live set worldwide is normally small).
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/**
 * Map one raw SondeHub telemetry entry to a normalized sonde record, or null
 * if it has no usable position.
 * @param {string} serial - The object key this entry was found under.
 * @param {object} raw - One value from the `/sondes/telemetry` response.
 * @returns {{id:string, lat:number, lon:number, altitudeM:number,
 *   verticalSpeedMs:number|null, horizontalSpeedMs:number|null,
 *   headingDeg:number|null, tempC:number|null, launchSite:string|null,
 *   observedAt:string|null}|null}
 */
export function mapSondeTelemetry(serial, raw) {
  const lat = finiteOrNull(raw?.lat);
  const lon = finiteOrNull(raw?.lon);
  const altitudeM = finiteOrNull(raw?.alt);
  if (lat === null || lon === null || altitudeM === null) return null;
  const rawTime = raw?.datetime ?? raw?.time;
  const observedAt = typeof rawTime === 'string' && !Number.isNaN(Date.parse(rawTime))
    ? new Date(rawTime).toISOString()
    : null;
  return {
    id: textOrNull(serial) || textOrNull(raw?.serial) || `sonde:${lat.toFixed(4)},${lon.toFixed(4)}`,
    lat,
    lon,
    altitudeM,
    verticalSpeedMs: finiteOrNull(raw?.vel_v),
    horizontalSpeedMs: finiteOrNull(raw?.vel_h),
    headingDeg: finiteOrNull(raw?.heading),
    tempC: finiteOrNull(raw?.temp),
    launchSite: textOrNull(raw?.launch_site) || textOrNull(raw?.subtype),
    observedAt,
  };
}

/**
 * Map the full `/sondes/telemetry` response (an object keyed by serial) into
 * an array of normalized sonde records, dropping unusable entries.
 * @param {object} payload - Parsed JSON body of the upstream response.
 * @param {number} [maxCount=500] - Cap on returned records.
 * @returns {Array<object>} See `mapSondeTelemetry` for the record shape.
 */
export function mapSondeTelemetryFeed(payload, maxCount = 500) {
  if (!payload || typeof payload !== 'object') return [];
  const entries = [];
  for (const [serial, raw] of Object.entries(payload)) {
    const mapped = mapSondeTelemetry(serial, raw);
    if (mapped) entries.push(mapped);
    if (entries.length >= maxCount) break;
  }
  return entries;
}
