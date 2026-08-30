/**
 * @module data/volcanoesShape
 * @description Filter and normalization rules for the Smithsonian Global
 * Volcanism Program (GVP) Holocene volcano inventory.
 *
 * Pure module shared by the `/api/volcanoes` proxy (vite.config.js,
 * Node-only) and the Cesium-importing layer (volcanoes.js, browser-only) —
 * mirroring the existing `spaceWeatherShape.js` / `globalHazardsShape.js`
 * precedent so the server and the client run the SAME mapping/filtering
 * implementation instead of two copies that can drift apart.
 *
 * The GVP `Smithsonian_VOTW_Holocene_Volcanoes` layer lists ~1,400 volcanoes
 * active at some point in the Holocene (last ~11,700 years) — most of them
 * dormant for millennia. `mapVolcanoFeature` keeps only volcanoes with a
 * recorded eruption since `MIN_ERUPTION_YEAR`, which is "recently active"
 * without dumping the entire Holocene inventory onto the globe.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/** Eruption-year floor: keeps roughly the last 125 years of activity. */
export const MIN_ERUPTION_YEAR = 1900;

/**
 * Map one raw GVP GeoJSON feature to a normalized volcano record, or null if
 * the feature should be filtered out (no qualifying recent eruption, or
 * unusable coordinates).
 * @param {object} feature - A GVP `GetFeature` GeoJSON feature.
 * @returns {{id:string, name:string, lat:number, lon:number,
 *   lastEruptionYear:number, country:string|null, volcanoType:string|null,
 *   elevationM:number|null}|null}
 */
export function mapVolcanoFeature(feature) {
  const p = feature?.properties;
  if (!p) return null;
  const lastEruptionYear = finiteOrNull(p.Last_Eruption_Year);
  if (lastEruptionYear === null || lastEruptionYear < MIN_ERUPTION_YEAR) return null;
  const [lon, lat] = feature.geometry?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const volcanoNumber = textOrNull(p.Volcano_Number);
  return {
    id: volcanoNumber ? `gvp:${volcanoNumber}` : `gvp:${lon.toFixed(4)},${lat.toFixed(4)}`,
    name: textOrNull(p.Volcano_Name) || 'Unnamed volcano',
    lat,
    lon,
    lastEruptionYear,
    country: textOrNull(p.Country),
    volcanoType: textOrNull(p.Primary_Volcano_Type),
    elevationM: finiteOrNull(p.Elevation),
  };
}
