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
