/**
 * @module data/gdeltEventsShape
 * @description Presets and normalization for the GDELT global event layer.
 *
 * Pure module, shared by the `/api/gdelt/geo` proxy and the layer that renders
 * it, so the two cannot disagree about a record's shape.
 *
 * ## The query surface is a closed allowlist, on purpose
 *
 * GDELT's GEO API takes arbitrary text and will happily geocode a person's
 * name across worldwide news. This project explicitly does not build
 * named-person search, so the client never sends a query at all: it sends a
 * PRESET ID, the proxy looks the id up in the table below, and anything not in
 * the table is refused. That is a structural guarantee rather than a policy
 * note — there is no code path that forwards user text to GDELT.
 *
 * The presets are GDELT GKG theme operators. A theme GDELT has renamed or
 * retired returns an empty result, which the layer reports as "no reports"
 * distinctly from a failed request; fixing it is a one-line edit here.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/**
 * Selectable event themes.
 *
 * `query` values are GDELT GKG theme operators, not free text. Keep this list
 * short and event-shaped: every entry must describe something that HAPPENS in
 * a place, never a category of person.
 */
export const GDELT_PRESETS = Object.freeze([
  Object.freeze({
    id: 'unrest',
    label: 'UNREST',
    query: 'theme:PROTEST',
    description: 'Protests and civil unrest reported in the last 24 hours',
    accent: '#ffd23f',
  }),
  Object.freeze({
    id: 'conflict',
    label: 'CONFLICT',
    query: 'theme:ARMEDCONFLICT',
    description: 'Armed conflict reporting in the last 24 hours',
    accent: '#ff4d3d',
  }),
  Object.freeze({
    id: 'disaster',
    label: 'DISASTER',
    query: 'theme:NATURAL_DISASTER',
    description: 'Natural disaster reporting in the last 24 hours',
    accent: '#38e1ff',
  }),
]);

/** Default preset when none is chosen. */
export const DEFAULT_GDELT_PRESET_ID = 'disaster';

const PRESETS_BY_ID = new Map(GDELT_PRESETS.map((preset) => [preset.id, preset]));

/**
 * Resolve a preset id to its descriptor.
 *
 * Returns null for anything unknown. Callers must treat null as a refusal, not
 * as "fall back to something" — silently substituting a different query would
 * make the layer's label a lie.
 *
 * @param {string} id Preset id.
 * @returns {object|null}
 */
export function resolvePreset(id) {
  if (typeof id !== 'string') return null;
  return PRESETS_BY_ID.get(id) || null;
}

/** Every valid preset id. */
export const GDELT_PRESET_IDS = Object.freeze(GDELT_PRESETS.map((preset) => preset.id));

const asNumber = finiteOrNull;

const asText = textOrNull;

/**
 * Strip HTML to plain text, bounded.
 *
 * GDELT's `html` property carries an article popup with markup and links. Only
 * a short plain-text remnant is kept: the layer renders into a Cesium label,
 * markup there would be shown literally, and an unbounded string from an
 * external feed does not belong in the render path.
 *
 * @param {string} value Raw HTML.
 * @param {number} [maxLength] Ceiling.
 * @returns {string|null}
 */
export function stripHtml(value, maxLength = 240) {
  const raw = String(value ?? '');
  if (!raw) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Attribute aliases, tolerant of GEO API revisions. */
export const GDELT_FIELD_ALIASES = Object.freeze({
  name: ['name', 'location', 'Name'],
  count: ['count', 'Count', 'mentions'],
  html: ['html', 'Html', 'popup'],
  url: ['url', 'shareurl', 'sourceurl'],
});

/** First present alias in a properties bag. */
export function pickField(properties, aliases) {
  if (!properties) return null;
  for (const key of aliases) {
    const value = properties[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

/**
 * Normalize one GDELT GEO feature into a compact record.
 * @param {object} feature GeoJSON feature.
 * @param {number} index Fallback identity.
 * @returns {object|null} Record, or null when it has no usable position.
 */
export function normalizeGdeltFeature(feature, index = 0) {
  const coordinates = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates)) return null;
  const lon = asNumber(coordinates[0]);
  const lat = asNumber(coordinates[1]);
  if (lon === null || lat === null) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;

  const properties = feature.properties || {};
  const name = asText(pickField(properties, GDELT_FIELD_ALIASES.name)) || 'UNNAMED LOCATION';
  return {
    id: `gdelt-${index}-${lon.toFixed(3)},${lat.toFixed(3)}`,
    name,
    lon,
    lat,
    // Mentions, NOT events. GDELT counts how often a place was mentioned in
    // matching coverage; the layer must never present this as an event count.
    mentions: asNumber(pickField(properties, GDELT_FIELD_ALIASES.count)) ?? 1,
    summary: stripHtml(pickField(properties, GDELT_FIELD_ALIASES.html)),
  };
}

/**
 * Normalize a GDELT GEO FeatureCollection into a bounded record set.
 *
 * Ordered by mention count so that, when the cap binds, what survives is the
 * most-reported places rather than an arbitrary prefix.
 *
 * @param {object} collection GeoJSON FeatureCollection.
 * @param {object} [options]
 * @returns {{records: Array<object>, truncated: boolean, totalFeatures: number, maxMentions: number}}
 */
export function normalizeGdeltCollection(collection, { maxRecords = 750 } = {}) {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const records = [];
  for (let i = 0; i < features.length; i += 1) {
    const record = normalizeGdeltFeature(features[i], i);
    if (record) records.push(record);
  }
  records.sort((a, b) => b.mentions - a.mentions);
  const truncated = records.length > maxRecords;
  const kept = truncated ? records.slice(0, maxRecords) : records;
  let maxMentions = 0;
  for (const record of kept) if (record.mentions > maxMentions) maxMentions = record.mentions;
  return { records: kept, truncated, totalFeatures: features.length, maxMentions };
}

/**
 * Marker size in pixels for a mention count, scaled against the busiest place
 * in the current set.
 *
 * Relative rather than absolute: a quiet day's peak and a crisis day's peak
 * differ by orders of magnitude, and a fixed scale would render one of them
 * invisible and the other a solid blob.
 *
 * @param {number} mentions This record's mentions.
 * @param {number} maxMentions Busiest place in the set.
 * @returns {number} Pixel size.
 */
export function mentionPixelSize(mentions, maxMentions) {
  const value = Number(mentions);
  const peak = Number(maxMentions);
  if (!Number.isFinite(value) || value <= 0) return 5;
  if (!Number.isFinite(peak) || peak <= 1) return 8;
  // Log scale: mention counts are heavy-tailed, and a linear ramp puts every
  // ordinary place at the floor next to one enormous dot.
  const ratio = Math.log(1 + value) / Math.log(1 + peak);
  return Math.round(5 + Math.min(1, Math.max(0, ratio)) * 13);
}
