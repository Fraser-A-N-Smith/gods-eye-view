/**
 * @module data/acledEventsShape
 * @description Presets and normalization for ACLED (Armed Conflict Location
 * & Event Data Project) political-violence and protest events.
 *
 * Pure module shared by the `/api/acled-events` proxy and the layer — same
 * split as every other layer in this app.
 *
 * ## What this adds over the GDELT layers
 *
 * Both GDELT layers are machine-extracted from news text. ACLED's records
 * are human-coded by regional research teams from media, partner, and local
 * source reporting, geocoded to a specific locality where possible (not just
 * a country/region centroid) with an explicit `geo_precision` flag. Higher
 * confidence than GDELT, still not ground truth — ACLED's own methodology is
 * source-derived reporting, not first-hand verification, and every record
 * here carries that hedge and ACLED's own `source`/`notes` fields so the
 * record is never presented as more certain than ACLED itself claims.
 *
 * ## Closed preset allowlist, same discipline as every other layer here
 *
 * The client sends a PRESET ID; the proxy resolves it to ACLED's own
 * `event_type` taxonomy value. There is no path for caller text to reach
 * ACLED's `event_type` filter directly.
 *
 * ## Licence
 *
 * Free for non-commercial use under ACLED's own EULA (not a Creative
 * Commons licence) — registration required, commercial use needs a
 * corporate licence from ACLED. Recorded in DATA_SOURCES.md next to the
 * Global Fishing Watch and TeleGeography NonCommercial carve-outs.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/**
 * Selectable event types. `eventType` values are ACLED's own `event_type`
 * taxonomy strings (stable, documented at acleddata.com) — the client never
 * sends this string itself, only the preset id.
 */
export const ACLED_PRESETS = Object.freeze([
  Object.freeze({ id: 'battles', label: 'BATTLES', eventType: 'Battles', accent: '#ff4d3d' }),
  Object.freeze({
    id: 'violence-against-civilians',
    label: 'VIOLENCE AGAINST CIVILIANS',
    eventType: 'Violence against civilians',
    accent: '#ff884d',
  }),
  Object.freeze({
    id: 'explosions-remote-violence',
    label: 'EXPLOSIONS / REMOTE VIOLENCE',
    eventType: 'Explosions/Remote violence',
    accent: '#ffd23f',
  }),
  Object.freeze({ id: 'riots', label: 'RIOTS', eventType: 'Riots', accent: '#c084fc' }),
  Object.freeze({ id: 'protests', label: 'PROTESTS', eventType: 'Protests', accent: '#38b6ff' }),
  Object.freeze({
    id: 'strategic-developments',
    label: 'STRATEGIC DEVELOPMENTS',
    eventType: 'Strategic developments',
    accent: '#4ade80',
  }),
]);

/** Default event type. Battles is the reason a conflict-data layer exists. */
export const DEFAULT_ACLED_PRESET_ID = 'battles';

const PRESETS_BY_ID = new Map(ACLED_PRESETS.map((preset) => [preset.id, preset]));

/** Every valid preset id. */
export const ACLED_PRESET_IDS = Object.freeze(ACLED_PRESETS.map((preset) => preset.id));

/**
 * Resolve a preset id. Returns null for anything unknown — a refusal, never
 * a substitution, so the layer's label always matches what was fetched.
 * @param {string} id Preset id.
 * @returns {object|null}
 */
export function resolveAcledPreset(id) {
  if (typeof id !== 'string') return null;
  return PRESETS_BY_ID.get(id) || null;
}

/**
 * ACLED's own `geo_precision` codebook: 1 = exact named site with a real
 * coordinate; 2 = a town/city is known but the coordinate is that place's
 * centroid, not the exact site; 3 = only a broader region is known and the
 * coordinate is that region's centroid.
 */
const GEO_PRECISION_LABELS = Object.freeze({ 1: 'exact', 2: 'approximate', 3: 'regional' });

/**
 * Precision label for an ACLED `geo_precision` code.
 * @param {*} value Raw geo_precision field.
 * @returns {string} One of 'exact'/'approximate'/'regional'/'unknown'.
 */
export function acledPrecisionFor(value) {
  const code = finiteOrNull(value);
  if (code === null) return 'unknown';
  return GEO_PRECISION_LABELS[code] || 'unknown';
}

/**
 * ACLED is source-derived reporting, coded by regional research teams — not
 * first-hand verification. Attached per record (not just shown in the
 * layer chrome) so no render path can drop it.
 */
export const ACLED_CAVEAT = 'ACLED-CODED FROM MEDIA/PARTNER REPORTING — NOT INDEPENDENTLY VERIFIED';

/**
 * Epoch ms for an ACLED `event_date` (`YYYY-MM-DD`).
 * @param {string} value Raw event_date field.
 * @returns {number|null}
 */
export function eventDateMsUtc(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Normalize one raw ACLED event row.
 * @param {object} entry Raw ACLED API row.
 * @param {object} preset Preset descriptor.
 * @param {number} index Fallback identity.
 * @returns {object|null}
 */
export function normalizeAcledEvent(entry, preset, index = 0) {
  if (!entry) return null;
  const lat = finiteOrNull(entry.latitude);
  const lon = finiteOrNull(entry.longitude);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return {
    id: textOrNull(entry.event_id_cnty) || `${preset.id}-${index}`,
    type: preset.id,
    lat,
    lon,
    dateMs: eventDateMsUtc(entry.event_date),
    country: textOrNull(entry.country),
    location: textOrNull(entry.location),
    actor1: textOrNull(entry.actor1),
    actor2: textOrNull(entry.actor2),
    fatalities: finiteOrNull(entry.fatalities),
    precision: acledPrecisionFor(entry.geo_precision),
    source: textOrNull(entry.source),
    notes: textOrNull(entry.notes),
    // Carried per-record so a card cannot render an event without its hedge.
    caveat: ACLED_CAVEAT,
  };
}

/**
 * Normalize an ACLED `/acled/read` response.
 *
 * Ordered most-recent-first — for a rolling conflict-data window, recency is
 * the signal an operator cares about, not an arbitrary API order.
 *
 * @param {object} payload Raw response (`{data: [...], count}` shape).
 * @param {object} preset Preset descriptor.
 * @param {object} [options]
 * @returns {{events: Array<object>, truncated: boolean, total: number|null}}
 */
export function normalizeAcledEvents(payload, preset, { maxEvents = 600 } = {}) {
  const raw = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  const events = [];
  for (let i = 0; i < raw.length; i += 1) {
    const event = normalizeAcledEvent(raw[i], preset, i);
    if (event) events.push(event);
  }
  events.sort((a, b) => (b.dateMs ?? 0) - (a.dateMs ?? 0));
  const truncated = events.length > maxEvents;
  return {
    events: truncated ? events.slice(0, maxEvents) : events,
    truncated,
    total: finiteOrNull(payload?.count) ?? events.length,
  };
}

/**
 * Marker size for an event, scaled by fatalities where known — otherwise a
 * flat size, since "unknown" must not render as "zero" (a zero-fatality riot
 * is a real, common ACLED record).
 * @param {number|null} fatalities Reported fatality count.
 * @returns {number} Pixel size.
 */
export function acledEventPixelSize(fatalities) {
  const value = finiteOrNull(fatalities);
  if (value === null) return 6;
  if (value <= 0) return 5;
  const ratio = Math.min(1, Math.log(1 + value) / Math.log(1 + 200));
  return Math.round(6 + ratio * 12);
}
