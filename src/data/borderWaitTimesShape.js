/**
 * @module data/borderWaitTimesShape
 * @description Pure join/map logic for CBP's `https://bwt.cbp.gov/api/waittimes`
 * feed.
 *
 * Pure module shared by the `/api/border-wait-times` proxy (vite.config.js,
 * Node-only) and the Cesium-importing layer (borderWaitTimes.js,
 * browser-only) — mirroring the existing `spaceWeatherShape.js` /
 * `globalHazardsShape.js` / `volcanoesShape.js` / `oceanBuoysShape.js` /
 * `hamRadioPropagationShape.js` / `criticalInfrastructureShape.js` precedent
 * so the server and the client run the SAME join implementation instead of
 * two copies that can drift apart.
 *
 * CBP's live wait-time feed is keyed by `port_number` but carries no
 * coordinates, and no companion endpoint with lat/lon exists (confirmed
 * during planning: `/api/bwtPorts`, `/api/ports`, and several ArcGIS
 * FeatureServer guesses were all tried and none returned usable data). This
 * is why God's Eye View ships a small, hand-verified static lookup,
 * `config/cbp_port_locations.json` — mapping `port_number` to
 * `{name, lat, lon}` for the ~25 highest-traffic land crossings — and joins
 * every wait-time entry against it here. An entry whose `port_number` has no
 * match in that lookup is dropped (returns null), never plotted with a
 * guessed or fallback position.
 */

import { finiteOrNull } from './numeric.js';

/**
 * Map one raw CBP wait-time entry to a placeable crossing record by joining
 * it against the static `port_number -> {name, lat, lon}` lookup. Pure — no
 * Cesium types, no network access. Returns null if `entry.port_number` has
 * no match in `locations` (the entry is silently unplaceable, not a
 * malformed-data error).
 *
 * `delay_minutes` arrives from CBP as a STRING that may be `""` (no report)
 * — that empty string must become `null`, never `NaN` or `0`: a crossing
 * with no reported delay is not the same as a crossing confirmed at zero
 * minutes.
 *
 * @param {Object|null|undefined} entry - One raw element of the
 *   `https://bwt.cbp.gov/api/waittimes` JSON array.
 * @param {Object<string, {name: string, lat: number, lon: number}>} locations
 *   - The parsed `config/cbp_port_locations.json` lookup, keyed by
 *   `port_number`.
 * @returns {{id: string, name: string, border: string|null, lat: number,
 *   lon: number, waitMinutes: number|null, status: string|null}|null}
 */
export function mapWaitTimeEntry(entry, locations) {
  const portNumber = entry?.port_number;
  // Object.hasOwn (not `locations?.[portNumber]`) so a CBP entry reporting
  // `port_number: "constructor"` (or any other Object.prototype key) can
  // never resolve to a prototype method instead of a real, or absent, entry.
  const location = portNumber != null && locations && Object.hasOwn(locations, portNumber)
    ? locations[portNumber]
    : null;
  if (!location) return null;

  const rawDelay = entry?.passenger_vehicle_lanes?.standard_lanes?.delay_minutes;

  return {
    id: String(portNumber),
    name: location.name,
    border: entry?.border ?? null,
    lat: location.lat,
    lon: location.lon,
    waitMinutes: finiteOrNull(rawDelay),
    status: entry?.port_status ?? null,
  };
}

/**
 * Join a raw `https://bwt.cbp.gov/api/waittimes` array against the static
 * locations lookup, dropping any entry with no coordinate match. Pure — no
 * Cesium types, no network access.
 *
 * @param {Array<Object>} entries - The raw upstream JSON array.
 * @param {Object<string, {name: string, lat: number, lon: number}>} locations
 * @returns {Array<object>} See {@link mapWaitTimeEntry} for the record shape.
 */
export function mapWaitTimeEntries(entries, locations) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    const mapped = mapWaitTimeEntry(entry, locations);
    if (mapped) out.push(mapped);
  }
  return out;
}
