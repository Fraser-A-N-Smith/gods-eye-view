/**
 * @module data/globalHazardsShape
 * @description GDACS/EONET filter and normalization rules for the Global
 * Hazards layer.
 *
 * Pure module shared by the `/api/global-hazards` proxy (vite.config.js,
 * Node-only) and the Cesium-importing layer (globalHazards.js, browser-only).
 * Neither the filter constants nor the two mapper functions below touch
 * Cesium, so this module can be imported directly into vite.config.js's Node
 * process without dragging the `cesium` package along — mirroring the
 * existing `spaceWeatherShape.js` precedent for the same reason.
 *
 * Filtering exists to avoid duplicating a hazard type another layer already
 * renders: GDACS `EQ`/`TC`/`WF`/`VO` duplicate the earthquakes, tropical
 * cyclones, FIRMS, and volcanoes layers respectively; EONET
 * `wildfires`/`volcanoes`/`earthquakes`/`floods` duplicate the same set (plus
 * GDACS floods). What survives is GDACS floods/droughts plus the EONET
 * categories with no dedicated layer of their own.
 */

/** GDACS `eventtype` codes kept here. EQ/TC/WF/VO all duplicate a dedicated layer. */
export const GDACS_HAZARD_TYPES = new Set(['FL', 'DR']);

/** EONET `categories[0].id` values kept here. wildfires/volcanoes/earthquakes/floods all dup a dedicated layer. */
export const EONET_HAZARD_CATEGORIES = new Set([
  'severeStorms', 'landslides', 'seaLakeIce', 'tempExtremes', 'dustHaze', 'snow', 'waterColor',
]);

/**
 * Map one raw GDACS GeoJSON feature to a normalized hazard record, or null
 * if the feature should be filtered out.
 * @param {object} feature - A GDACS `geteventlist` GeoJSON feature.
 * @returns {{id:string, source:'GDACS', kind:string, title:string, lat:number,
 *   lon:number, severity:string, url:string|null, dateMs:number|null}|null}
 */
export function mapGdacsFeature(feature) {
  const p = feature?.properties;
  if (!p || !GDACS_HAZARD_TYPES.has(p.eventtype)) return null;
  if (p.iscurrent !== 'true' || p.alertlevel === 'Green') return null;
  const [lon, lat] = feature.geometry?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    id: `gdacs:${p.eventtype}:${p.eventid}`,
    source: 'GDACS',
    kind: p.eventtype,
    title: p.name || p.description || 'GDACS event',
    lat,
    lon,
    severity: p.alertlevel || 'Orange',
    url: p.url?.report || null,
    dateMs: Date.parse(p.datemodified || p.fromdate || '') || null,
  };
}

/**
 * Map one raw EONET event to a normalized hazard record, or null if the
 * event should be filtered out. Takes the LAST geometry entry — EONET events
 * can carry a track of points over time, and the most recent is current.
 * @param {object} event - A NASA EONET v3 event.
 * @returns {{id:string, source:'EONET', kind:string, title:string, lat:number,
 *   lon:number, severity:string, url:string|null, dateMs:number|null}|null}
 */
export function mapEonetFeature(event) {
  const categoryId = event?.categories?.[0]?.id;
  if (!categoryId || !EONET_HAZARD_CATEGORIES.has(categoryId)) return null;
  const geom = Array.isArray(event.geometry) ? event.geometry.at(-1) : null;
  const [lon, lat] = geom?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    id: `eonet:${event.id}`,
    source: 'EONET',
    kind: categoryId,
    title: event.title || 'EONET event',
    lat,
    lon,
    severity: 'Orange',
    url: event.link || null,
    dateMs: Date.parse(geom?.date || '') || null,
  };
}
