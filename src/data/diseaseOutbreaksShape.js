/**
 * @module data/diseaseOutbreaksShape
 * @description Normalization for WHO Disease Outbreak News (DON) entries —
 * the app's first health/epidemiological event category.
 *
 * Pure module shared by the `/api/disease-outbreaks` proxy (vite.config.js,
 * Node-only) and the Cesium-importing layer (diseaseOutbreaks.js,
 * browser-only) — mirroring the existing `spaceWeatherShape.js` /
 * `globalHazardsShape.js` / `volcanoesShape.js` precedent so the server and
 * the client run the SAME mapping implementation.
 *
 * WHO DON entries report at COUNTRY granularity, not lat/lon — there is no
 * per-outbreak coordinate to plot. This module resolves each entry's
 * country name against the curated `countryCentroids.js` lookup; an entry
 * whose country has no match is dropped (not plotted with a guessed
 * position), the same "no match, no plot" discipline used for CBP Border
 * Wait Times.
 *
 * WHO's DON API's exact JSON field names could not be verified against a
 * live response while writing this (sandboxed network access) — field
 * access below is a best-effort tolerant mapping across several candidate
 * key spellings, worth re-checking against a live payload.
 */

import { textOrNull } from './numeric.js';
import { findCountryCentroid } from './countryCentroids.js';

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Map one raw WHO DON entry to a placeable outbreak record, or null if it
 * has no usable title, or its country has no match in the curated centroid
 * table.
 * @param {object} raw - One element of the upstream DON list.
 * @returns {{id:string, title:string, country:string, lat:number, lon:number,
 *   publishedAt:string|null, url:string|null}|null}
 */
export function mapDiseaseOutbreakEntry(raw) {
  const title = textOrNull(raw?.Title ?? raw?.title ?? raw?.name);
  const countryName = textOrNull(raw?.Country ?? raw?.country ?? raw?.PrimaryCountry ?? raw?.primaryCountry);
  if (!title || !countryName) return null;
  const position = findCountryCentroid(countryName);
  if (!position) return null;

  const rawDate = raw?.PublicationDateAndTime ?? raw?.publicationDate ?? raw?.date ?? raw?.PublishedDate;
  const publishedAt = typeof rawDate === 'string' && !Number.isNaN(Date.parse(rawDate))
    ? new Date(rawDate).toISOString()
    : null;

  // UrlName is typically a bare slug (WHO's DON items live under a fixed
  // path); url/Link, if present, is more likely a full address already.
  const rawUrl = raw?.url ?? raw?.Link ?? raw?.link;
  const rawSlug = textOrNull(raw?.UrlName);
  const url = safeHttpUrl(rawUrl)
    || (rawSlug ? safeHttpUrl(`https://www.who.int/emergencies/disease-outbreak-news/item/${rawSlug}`) : null);

  const idSeed = textOrNull(raw?.UrlName ?? raw?.id ?? raw?.ItemDefaultUrl) || `${countryName}:${title}`;
  return {
    id: `who-don:${idSeed}`.slice(0, 160),
    title,
    country: countryName,
    lat: position[0],
    lon: position[1],
    publishedAt,
    url,
  };
}

/**
 * Map the full upstream DON response into an array of normalized outbreak
 * records, dropping unusable entries.
 * @param {object} payload - Parsed JSON body of the upstream response.
 * @param {number} [maxCount=200] - Cap on returned records.
 * @returns {Array<object>} See `mapDiseaseOutbreakEntry` for the record shape.
 */
export function mapDiseaseOutbreakFeed(payload, maxCount = 200) {
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.value) ? payload.value
      : Array.isArray(payload?.result) ? payload.result
        : [];
  const out = [];
  for (const row of rows) {
    const mapped = mapDiseaseOutbreakEntry(row);
    if (mapped) out.push(mapped);
    if (out.length >= maxCount) break;
  }
  return out;
}
