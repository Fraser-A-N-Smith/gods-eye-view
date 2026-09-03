/**
 * @module data/oceanBuoysShape
 * @description Fixed-width text parser for the NOAA National Data Buoy
 * Center (NDBC) `latest_obs.txt` feed.
 *
 * Pure module shared by the `/api/ocean-buoys` proxy (vite.config.js,
 * Node-only) and the Cesium-importing layer (oceanBuoys.js, browser-only) —
 * mirroring the existing `spaceWeatherShape.js` / `globalHazardsShape.js` /
 * `volcanoesShape.js` precedent so the server and the client run the SAME
 * parsing implementation instead of two copies that can drift apart.
 *
 * Unlike every other upstream this app reads, NDBC's `latest_obs.txt` is
 * whitespace-delimited FIXED-COLUMN plain text, not JSON or CSV — the first
 * two lines are `#`-prefixed headers, and any numeric field the buoy did not
 * report renders as the literal token `MM` rather than being omitted. `MM`
 * must map to `null`, never `NaN` or `0`: a buoy with no wave-height sensor
 * reading is not a buoy reporting calm seas.
 */

import { finiteOrNull } from './numeric.js';

/** Column order of one NDBC `latest_obs.txt` data row, left to right. */
const NDBC_COLUMNS = [
  'stn', 'lat', 'lon', 'yyyy', 'mm', 'dd', 'hh', 'mn',
  'wdir', 'wspd', 'gst', 'wvht', 'dpd', 'apd', 'mwd',
  'pres', 'ptdy', 'atmp', 'wtmp', 'dewp', 'vis', 'tide',
];

/** `MM` (missing) → null. Otherwise a finite number, or null. */
function ndbcNum(token) {
  if (token === undefined || token === 'MM') return null;
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one line of `latest_obs.txt` into a normalized buoy observation, or
 * null if the line is a header, blank, malformed, or missing coordinates.
 * @param {string} line - One raw line from the upstream text response.
 * @returns {{id:string, lat:number, lon:number, windSpeedMs:number|null,
 *   waveHeightM:number|null, airTempC:number|null, waterTempC:number|null}|null}
 */
export function parseNdbcLine(line) {
  if (typeof line !== 'string' || !line.trim() || line.trim().startsWith('#')) return null;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < NDBC_COLUMNS.length) return null;
  const row = Object.fromEntries(NDBC_COLUMNS.map((key, i) => [key, tokens[i]]));
  const lat = ndbcNum(row.lat);
  const lon = ndbcNum(row.lon);
  if (lat === null || lon === null) return null;
  return {
    id: row.stn,
    lat,
    lon,
    windSpeedMs: ndbcNum(row.wspd),
    waveHeightM: ndbcNum(row.wvht),
    airTempC: ndbcNum(row.atmp),
    waterTempC: ndbcNum(row.wtmp),
  };
}

/**
 * Parse the complete `latest_obs.txt` response into normalized buoy
 * observations, skipping the two `#`-prefixed header lines and dropping any
 * malformed rows.
 * @param {string} text - The raw upstream text response.
 * @returns {Array<object>} See `parseNdbcLine` for the record shape.
 */
export function parseNdbcText(text) {
  if (typeof text !== 'string') return [];
  return text.split('\n').map(parseNdbcLine).filter(Boolean);
}

/**
 * Map one NOAA CO-OPS `datagetter` water-level response for a single station
 * into the same record shape as an NDBC buoy observation (plus
 * `stationType`/`waterLevelM`), tagged `stationType: 'co-ops-tide'` so the
 * layer/analyst engine can tell the two station kinds apart.
 *
 * Unlike NDBC's single bulk `latest_obs.txt`, CO-OPS has no bulk "latest
 * reading for every station" endpoint — each station's current water level
 * is its own `datagetter` request. This is why God's Eye View ships a small,
 * curated `config/co_ops_stations.json` (major US harbors only, same
 * "curated subset" shape as `config/cbp_port_locations.json`) rather than
 * querying CO-OPS's full station catalog live.
 *
 * Best-effort field mapping against CO-OPS's published `datagetter` JSON
 * format (`{ data: [{ t, v, ... }] }`, one row per requested date/time) —
 * worth re-checking against a live response before relying on this beyond
 * "best-effort tide reading."
 *
 * @param {string} stationId - The CO-OPS station id this response is for.
 * @param {{name:string, lat:number, lon:number}} location - The station's
 *   entry from `config/co_ops_stations.json`.
 * @param {object} payload - Parsed JSON body of one `datagetter` response.
 * @returns {{id:string, lat:number, lon:number, name:string,
 *   stationType:'co-ops-tide', waterLevelM:number|null,
 *   windSpeedMs:null, waveHeightM:null, airTempC:null, waterTempC:null}|null}
 */
export function mapCoOpsStation(stationId, location, payload) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return null;
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const latest = rows.at(-1);
  // finiteOrNull, not Number(): Number('') === 0 (finite!) would turn a
  // missing reading into "zero water level", a real value, not an absence.
  const waterLevelM = finiteOrNull(latest?.v);
  return {
    id: `co-ops:${stationId}`,
    lat: location.lat,
    lon: location.lon,
    name: location.name,
    stationType: 'co-ops-tide',
    waterLevelM,
    windSpeedMs: null,
    waveHeightM: null,
    airTempC: null,
    waterTempC: null,
  };
}
