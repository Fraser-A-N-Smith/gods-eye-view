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

/** The actual USGS Volcano Alert Level System — not a guess, unlike the JSON field names below. */
const VOLCANO_ALERT_LEVELS = ['NORMAL', 'ADVISORY', 'WATCH', 'WARNING'];
/** The actual USGS/NOAA aviation color code scale for volcanic ash hazard — not a guess either. */
const VOLCANO_COLOR_CODES = ['GREEN', 'YELLOW', 'ORANGE', 'RED'];

function normalizeAlertVocabulary(value, allowed) {
  const text = textOrNull(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  return allowed.includes(upper) ? upper : null;
}

/**
 * Map one raw USGS Volcano Notification/Message API entry to a normalized
 * alert record, or null if it carries no usable volcano name or recognized
 * alert level/color code.
 *
 * Field names are a best-effort tolerant mapping (several candidate keys
 * checked per field) against USGS's published volcano-message API, since
 * the exact JSON shape could not be verified against a live response while
 * writing this — worth re-checking before relying on this beyond
 * "best-effort live status." The alert-level and aviation-color-code
 * vocabularies themselves ARE the real USGS system, not a guess.
 * @param {object} raw - One element of the upstream message list.
 * @returns {{volcanoName:string, alertLevel:string|null, colorCode:string|null,
 *   updatedAt:string|null}|null}
 */
export function mapVolcanoNotice(raw) {
  const volcanoName = textOrNull(raw?.volcano_name ?? raw?.volcanoName ?? raw?.name);
  if (!volcanoName) return null;
  const alertLevel = normalizeAlertVocabulary(
    raw?.alert_level ?? raw?.alertLevel ?? raw?.status,
    VOLCANO_ALERT_LEVELS,
  );
  const colorCode = normalizeAlertVocabulary(
    raw?.color_code ?? raw?.colorCode ?? raw?.aviation_color,
    VOLCANO_COLOR_CODES,
  );
  if (!alertLevel && !colorCode) return null;
  const rawUpdated = raw?.updated ?? raw?.last_updated ?? raw?.date;
  const updatedAt = typeof rawUpdated === 'string' && !Number.isNaN(Date.parse(rawUpdated))
    ? new Date(rawUpdated).toISOString()
    : null;
  return { volcanoName, alertLevel, colorCode, updatedAt };
}

/** Strip diacritics and normalize case/whitespace for tolerant volcano-name matching. */
function normalizeVolcanoName(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Attach a live USGS Volcano Notification alert (if any) to each GVP
 * volcano record by case/diacritic-insensitive name match. A volcano with
 * no matching notice is untouched (`alertLevel`/`colorCode`/`alertUpdatedAt`
 * all null) — the expected common case, since only a handful of US
 * observatories issue live notices against a global GVP catalog, not a
 * failure. Pure — no network access.
 * @param {Array<object>} volcanoes - `mapVolcanoFeature` output.
 * @param {Array<object>} notices - `mapVolcanoNotice` output.
 * @returns {Array<object>} The same records, each with alertLevel/colorCode/alertUpdatedAt added.
 */
export function mergeVolcanoAlerts(volcanoes, notices) {
  if (!Array.isArray(volcanoes)) return [];
  const byName = new Map();
  for (const notice of Array.isArray(notices) ? notices : []) {
    if (notice) byName.set(normalizeVolcanoName(notice.volcanoName), notice);
  }
  return volcanoes.map((volcano) => {
    const notice = byName.get(normalizeVolcanoName(volcano.name));
    return {
      ...volcano,
      alertLevel: notice?.alertLevel ?? null,
      colorCode: notice?.colorCode ?? null,
      alertUpdatedAt: notice?.updatedAt ?? null,
    };
  });
}
