/**
 * @module data/criticalInfrastructureShape
 * @description Pure element-mapping rule for the Critical Infrastructure
 * layer (OSM power plants + hospitals), shared by the `/api/critical-infrastructure`
 * proxy (vite.config.js, Node-only) and the Cesium-importing layer
 * (criticalInfrastructure.js, browser-only) — mirroring the existing
 * `globalHazardsShape.js` / `volcanoesShape.js` / `oceanBuoysShape.js` /
 * `hamRadioPropagationShape.js` precedent so the server and the client run the
 * SAME mapping implementation instead of two copies that can drift apart.
 *
 * The proxy runs this against raw Overpass `elements[]` before caching or
 * responding, so the client never re-implements the tag/coordinate mapping —
 * it only places the already-mapped records it receives.
 */

import { finiteOrNull } from './numeric.js';

/**
 * Map one raw Overpass element to a normalized critical-infrastructure
 * record, or null when the element matches neither watched tag, carries no
 * usable coordinate, or has no `type`/`id` to build a stable id from.
 *
 * `node` elements carry direct `lat`/`lon`; `way`/`relation` elements carry
 * `center.lat`/`center.lon` because the upstream query uses `out center`.
 *
 * @param {object} element - A raw Overpass `elements[]` item.
 * @returns {{id:string, kind:'power-plant'|'hospital', name:string, lat:number, lon:number}|null}
 */
export function mapOverpassElement(element) {
  // Required for a stable, collision-resistant id below: two elements both
  // missing `type`/`id` would otherwise both map to the literal string
  // "undefined/undefined" and collide once ids are deduplicated across a
  // pass (see entityDedupe.js) rather than left to Cesium's own throw.
  if (!element?.type || element?.id == null) return null;

  const tags = element?.tags || {};
  let kind = null;
  if (tags.power === 'plant') kind = 'power-plant';
  else if (tags.amenity === 'hospital') kind = 'hospital';
  if (!kind) return null;

  const lat = finiteOrNull(element?.lat) ?? finiteOrNull(element?.center?.lat);
  const lon = finiteOrNull(element?.lon) ?? finiteOrNull(element?.center?.lon);
  if (lat === null || lon === null) return null;

  const name = String(tags.name || '').trim()
    || (kind === 'power-plant' ? 'Unnamed power plant' : 'Unnamed hospital');

  return {
    id: `${element.type}/${element.id}`,
    kind,
    name,
    lat,
    lon,
  };
}
