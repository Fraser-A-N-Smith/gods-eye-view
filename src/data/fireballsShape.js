/**
 * @module data/fireballsShape
 * @description Pure fields+rows mapper for NASA/JPL CNEOS's
 * `https://ssd-api.jpl.nasa.gov/fireball.api` feed.
 *
 * Pure module shared by the `/api/fireballs` proxy (vite.config.js,
 * Node-only) and the Cesium-importing layer (fireballs.js, browser-only) —
 * mirroring the existing `spaceWeatherShape.js` / `globalHazardsShape.js` /
 * `volcanoesShape.js` / `oceanBuoysShape.js` / `hamRadioPropagationShape.js` /
 * `criticalInfrastructureShape.js` / `borderWaitTimesShape.js` precedent so
 * the server and the client run the SAME mapping implementation instead of
 * two copies that can drift apart.
 *
 * Unlike every JSON feed this app reads elsewhere, CNEOS's fireball API is a
 * **fields+rows** shape — `{ fields: [...columnNames], data: [[...rowValues],
 * ...] }` — not an array of objects, so each row must be zipped against
 * `fields` by name rather than destructured positionally.
 *
 * CNEOS also reports `lat`/`lon` as UNSIGNED MAGNITUDES with separate
 * `lat-dir` (`"N"`/`"S"`) and `lon-dir` (`"E"`/`"W"`) sign columns — the sign
 * must be applied here (`S` negates latitude, `W` negates longitude), or
 * every southern/western fireball silently lands in the wrong hemisphere.
 * `alt` and `vel` are frequently `null` upstream and must map to `null`,
 * never `NaN`.
 */

/**
 * Map one raw CNEOS fireball row to a placeable record by zipping it against
 * the feed's `fields` array and applying the `lat-dir`/`lon-dir` sign
 * columns. Pure — no Cesium types, no network access. Returns null when
 * `fields`/`row` aren't arrays, or when `lat`/`lon` can't be resolved to a
 * finite number.
 *
 * @param {Array<string>} fields - The feed's `fields` array, e.g.
 *   `["date","energy","impact-e","lat","lat-dir","lon","lon-dir","alt","vel"]`.
 * @param {Array<string|null>} row - One element of the feed's `data` array,
 *   positionally aligned with `fields`.
 * @returns {{id: string, dateMs: number|null, energyKt: number|null,
 *   impactEnergyKt: number|null, lat: number, lon: number,
 *   altitudeKm: number|null, velocityKmS: number|null}|null}
 */
export function mapFireballRow(fields, row) {
  if (!Array.isArray(fields) || !Array.isArray(row)) return null;
  const get = (key) => row[fields.indexOf(key)];
  const num = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
  let lat = num(get('lat'));
  let lon = num(get('lon'));
  if (lat === null || lon === null) return null;
  if (get('lat-dir') === 'S') lat = -lat;
  if (get('lon-dir') === 'W') lon = -lon;
  const dateStr = get('date');
  return {
    id: `${dateStr}:${lat}:${lon}`,
    dateMs: dateStr ? Date.parse(dateStr.replace(' ', 'T') + 'Z') : null,
    energyKt: num(get('energy')),
    impactEnergyKt: num(get('impact-e')),
    lat,
    lon,
    altitudeKm: num(get('alt')),
    velocityKmS: num(get('vel')),
  };
}

/**
 * Map every row of a CNEOS fireball `data` array to placeable records,
 * dropping any row `mapFireballRow` rejects. Pure — no Cesium types, no
 * network access.
 *
 * @param {Array<string>} fields - See {@link mapFireballRow}.
 * @param {Array<Array<string|null>>} rows - The feed's `data` array.
 * @returns {Array<object>} See {@link mapFireballRow} for the record shape.
 */
export function mapFireballRows(fields, rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    const mapped = mapFireballRow(fields, row);
    if (mapped) out.push(mapped);
  }
  return out;
}
