/**
 * @module data/firePerimetersShape
 * @description Normalization and simplification for wildfire perimeter polygons.
 *
 * Pure module, imported by BOTH the `/api/fire-perimeters` proxy in
 * vite.config.js and the layer that renders the result, so the two can never
 * disagree about the shape of a perimeter record.
 *
 * ## Why perimeters, when FIRMS hotspots already exist
 *
 * A FIRMS detection is a satellite pixel that was hot at an overpass. A
 * perimeter is the mapped edge of what has actually burned. A cluster of
 * hotspots tells you something is on fire; a perimeter tells you what is
 * inside it. They answer different questions and the app carries both.
 *
 * ## Field-name tolerance is deliberate
 *
 * The upstream is an ArcGIS feature service whose attribute names carry
 * source-dependent prefixes (`poly_`, `attr_`, `irwin_`) and have changed
 * across service revisions. Requesting a fixed field list makes the whole
 * query fail when one name drifts, so the proxy asks for all attributes and
 * the mapping below accepts any of the known spellings, in priority order.
 * A field that resolves to nothing becomes `null` and is rendered as
 * "unknown" rather than guessed at.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/** Candidate attribute names per logical field, most specific first. */
export const FIELD_ALIASES = Object.freeze({
  name: ['poly_IncidentName', 'attr_IncidentName', 'IncidentName', 'incident_name'],
  acres: ['poly_GISAcres', 'GISAcres', 'attr_IncidentSize', 'IncidentSize'],
  containedPct: ['attr_PercentContained', 'PercentContained', 'percent_contained'],
  discoveredAt: ['attr_FireDiscoveryDateTime', 'FireDiscoveryDateTime', 'fire_discovery_date_time'],
  id: ['attr_UniqueFireIdentifier', 'UniqueFireIdentifier', 'poly_SourceGlobalID', 'GlobalID', 'OBJECTID'],
  cause: ['attr_FireCause', 'FireCause'],
  state: ['attr_POOState', 'POOState'],
});

/** Read the first present alias from a properties bag. */
export function pickField(properties, aliases) {
  if (!properties) return null;
  for (const key of aliases) {
    const value = properties[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

const asNumber = finiteOrNull;

const asText = textOrNull;

/**
 * Ramer–Douglas–Peucker on a GeoJSON ring ([[lon,lat], …]).
 *
 * A closed ring must stay closed and must keep at least four points, or it
 * stops being a polygon; simplification that would drop below that returns the
 * ring untouched instead.
 *
 * @param {Array<Array<number>>} ring Coordinate ring.
 * @param {number} toleranceDeg Simplification tolerance in degrees.
 * @returns {Array<Array<number>>} Simplified ring.
 */
export function simplifyRing(ring, toleranceDeg) {
  if (!Array.isArray(ring) || ring.length <= 4 || !(toleranceDeg > 0)) return ring;
  const n = ring.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = ring[a][0];
    const ay = ring[a][1];
    const vx = ring[b][0] - ax;
    const vy = ring[b][1] - ay;
    const c2 = vx * vx + vy * vy;
    let worst = -1;
    let worstDist = toleranceDeg;
    for (let i = a + 1; i < b; i += 1) {
      const wx = ring[i][0] - ax;
      const wy = ring[i][1] - ay;
      let distance;
      if (c2 === 0) {
        distance = Math.hypot(wx, wy);
      } else {
        const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2));
        distance = Math.hypot(wx - t * vx, wy - t * vy);
      }
      if (distance > worstDist) {
        worstDist = distance;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(ring[i]);
  // Below four points there is no polygon left to draw — keep the original.
  if (out.length < 4) return ring;
  // Preserve closure: RDP keeps both endpoints, but a ring whose first and
  // last points were already identical must stay that way.
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out;
}

/**
 * Extract simplified outer rings from a GeoJSON geometry.
 *
 * Interior rings (holes — unburned islands inside a perimeter) are dropped:
 * the renderer draws filled outlines, and a hole rendered as another filled
 * polygon would read as a second fire. Dropping them is recorded on the record
 * as `hasHoles` so the UI can say the outline is the outer edge only.
 *
 * @param {object} geometry GeoJSON Polygon or MultiPolygon.
 * @param {number} toleranceDeg Simplification tolerance.
 * @returns {{rings: Array<Array<Array<number>>>, hasHoles: boolean}}
 */
export function outerRings(geometry, toleranceDeg) {
  const rings = [];
  let hasHoles = false;
  const type = geometry?.type;
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return { rings, hasHoles };

  const takePolygon = (polygon) => {
    if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) return;
    if (polygon.length > 1) hasHoles = true;
    const simplified = simplifyRing(polygon[0], toleranceDeg);
    if (simplified.length >= 4) rings.push(simplified);
  };

  if (type === 'Polygon') takePolygon(coordinates);
  else if (type === 'MultiPolygon') for (const polygon of coordinates) takePolygon(polygon);
  return { rings, hasHoles };
}

/**
 * Normalize one upstream feature into a compact perimeter record.
 * @param {object} feature GeoJSON feature.
 * @param {object} [options]
 * @param {number} [options.toleranceDeg] Simplification tolerance.
 * @param {number} [options.index] Fallback identity.
 * @returns {object|null} Record, or null when it has no drawable geometry.
 */
export function normalizePerimeter(feature, { toleranceDeg = 0.0015, index = 0 } = {}) {
  const properties = feature?.properties || {};
  const { rings, hasHoles } = outerRings(feature?.geometry, toleranceDeg);
  if (!rings.length) return null;

  let vertices = 0;
  for (const ring of rings) vertices += ring.length;

  return {
    id: asText(pickField(properties, FIELD_ALIASES.id)) || `perimeter-${index}`,
    name: asText(pickField(properties, FIELD_ALIASES.name)) || 'UNNAMED INCIDENT',
    acres: asNumber(pickField(properties, FIELD_ALIASES.acres)),
    containedPct: asNumber(pickField(properties, FIELD_ALIASES.containedPct)),
    discoveredAt: asText(pickField(properties, FIELD_ALIASES.discoveredAt)),
    cause: asText(pickField(properties, FIELD_ALIASES.cause)),
    state: asText(pickField(properties, FIELD_ALIASES.state)),
    rings,
    hasHoles,
    vertices,
  };
}

/**
 * Normalize an upstream FeatureCollection into a bounded perimeter set.
 *
 * Two independent caps apply. `maxFeatures` bounds how many incidents are
 * carried; `maxVertices` bounds total geometry, because a handful of very
 * large perimeters can carry more points than a thousand small ones. Whichever
 * binds first is reported in `truncated` so the layer can say the set is
 * partial rather than presenting it as every active fire.
 *
 * @param {object} collection GeoJSON FeatureCollection.
 * @param {object} [options]
 * @returns {{perimeters: Array<object>, truncated: boolean, totalFeatures: number, vertices: number}}
 */
export function normalizePerimeterCollection(collection, {
  toleranceDeg = 0.0015,
  maxFeatures = 600,
  maxVertices = 120_000,
} = {}) {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const perimeters = [];
  let vertices = 0;
  let truncated = false;

  // Largest first: if a cap binds, the fires that are dropped are the ones
  // least likely to be what someone is looking at.
  const ordered = [...features].sort((a, b) => {
    const aAcres = asNumber(pickField(a?.properties, FIELD_ALIASES.acres)) ?? 0;
    const bAcres = asNumber(pickField(b?.properties, FIELD_ALIASES.acres)) ?? 0;
    return bAcres - aAcres;
  });

  for (let i = 0; i < ordered.length; i += 1) {
    if (perimeters.length >= maxFeatures || vertices >= maxVertices) {
      truncated = true;
      break;
    }
    const record = normalizePerimeter(ordered[i], { toleranceDeg, index: i });
    if (!record) continue;
    perimeters.push(record);
    vertices += record.vertices;
  }

  return { perimeters, truncated, totalFeatures: features.length, vertices };
}
