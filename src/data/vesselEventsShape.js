/**
 * @module data/vesselEventsShape
 * @description Presets and normalization for Global Fishing Watch vessel events.
 *
 * Pure module shared by the `/api/vessel-events` proxy and the layer.
 *
 * ## What this adds that the AIS layer cannot
 *
 * The live vessel layer plots ships that are transmitting. This one plots
 * BEHAVIOUR derived from those tracks — and, crucially, the absence of them:
 *
 *  - **AIS gap** — a vessel stopped transmitting for an extended period and
 *    later reappeared. The interesting ships are frequently the quiet ones,
 *    and a live-position layer is structurally incapable of showing this.
 *  - **Encounter** — two vessels close and slow together long enough for a
 *    transfer at sea.
 *  - **Loitering** — a vessel idling far from shore.
 *  - **Port visit** — an arrival or departure.
 *
 * ## Inference, not observation, and the word matters
 *
 * Every one of these is a MODELLED interpretation of AIS tracks, not an
 * observed act. A gap can be a switched-off transponder or a satellite
 * coverage hole. An encounter can be a transfer or two ships passing slowly.
 * GFW's own guidance is emphatic that its fishing and event classifications
 * are apparent, not confirmed, so every label in this module carries that
 * hedge and the layer is required to render it.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/**
 * Selectable event types.
 *
 * `dataset` values are GFW v3 public dataset identifiers. As with the GDELT
 * layer, the client sends a PRESET ID and the proxy does the lookup — the
 * dataset string is never accepted from the caller.
 */
export const VESSEL_EVENT_PRESETS = Object.freeze([
  Object.freeze({
    id: 'gaps',
    label: 'AIS GAPS',
    dataset: 'public-global-gaps-events:latest',
    accent: '#ff4d3d',
    // The hedge is part of the preset, so it cannot be dropped downstream.
    caveat: 'APPARENT AIS DISABLING — MAY ALSO BE A COVERAGE HOLE',
  }),
  Object.freeze({
    id: 'encounters',
    label: 'ENCOUNTERS',
    dataset: 'public-global-encounters-events:latest',
    accent: '#ffd23f',
    caveat: 'APPARENT AT-SEA ENCOUNTER — NOT A CONFIRMED TRANSFER',
  }),
  Object.freeze({
    id: 'loitering',
    label: 'LOITERING',
    dataset: 'public-global-loitering-events:latest',
    accent: '#38e1ff',
    caveat: 'APPARENT LOITERING — SLOW TRANSIT FAR FROM SHORE',
  }),
  Object.freeze({
    id: 'port-visits',
    label: 'PORT VISITS',
    dataset: 'public-global-port-visits-events:latest',
    accent: '#4ade80',
    caveat: 'INFERRED PORT VISIT FROM AIS TRACK',
  }),
]);

/** Default event type. The gaps are the reason this layer exists. */
export const DEFAULT_VESSEL_EVENT_PRESET_ID = 'gaps';

const PRESETS_BY_ID = new Map(VESSEL_EVENT_PRESETS.map((preset) => [preset.id, preset]));

/**
 * Resolve a preset id. Returns null for anything unknown — a refusal, never a
 * substitution, so the layer's label always matches what was fetched.
 * @param {string} id Preset id.
 * @returns {object|null}
 */
export function resolveVesselEventPreset(id) {
  if (typeof id !== 'string') return null;
  return PRESETS_BY_ID.get(id) || null;
}

/** Every valid preset id. */
export const VESSEL_EVENT_PRESET_IDS = Object.freeze(VESSEL_EVENT_PRESETS.map((p) => p.id));

/**
 * Pull a vessel display name out of the several shapes GFW uses.
 *
 * Returns null rather than an id when no name is present: rendering an opaque
 * vessel id as if it were a name makes the card look authoritative about
 * something it does not know.
 *
 * @param {object} entry Raw event entry.
 * @returns {string|null}
 */
export function vesselName(entry) {
  const candidates = [
    entry?.vessel?.name,
    entry?.vessel?.shipname,
    Array.isArray(entry?.vessels) ? entry.vessels[0]?.name : null,
    Array.isArray(entry?.vessels) ? entry.vessels[0]?.shipname : null,
  ];
  for (const candidate of candidates) {
    const name = textOrNull(candidate);
    if (name) return name;
  }
  return null;
}

/**
 * Duration in hours between two ISO timestamps, or null.
 * @param {string} start ISO timestamp.
 * @param {string} end ISO timestamp.
 * @returns {number|null}
 */
export function durationHours(start, end) {
  const from = Date.parse(String(start ?? ''));
  const to = Date.parse(String(end ?? ''));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return (to - from) / 3_600_000;
}

/**
 * Normalize one GFW event entry.
 * @param {object} entry Raw event.
 * @param {object} preset Preset descriptor.
 * @param {number} index Fallback identity.
 * @returns {object|null}
 */
export function normalizeVesselEvent(entry, preset, index = 0) {
  if (!entry) return null;
  const lat = finiteOrNull(entry.position?.lat ?? entry.lat);
  const lon = finiteOrNull(entry.position?.lon ?? entry.lon);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return {
    id: textOrNull(entry.id) || `${preset.id}-${index}`,
    type: preset.id,
    lat,
    lon,
    start: textOrNull(entry.start),
    end: textOrNull(entry.end),
    durationHours: durationHours(entry.start, entry.end),
    // Null, not the id, when GFW has no name for the vessel.
    vessel: vesselName(entry),
    flag: textOrNull(entry.vessel?.flag ?? (Array.isArray(entry.vessels) ? entry.vessels[0]?.flag : null)),
    // Carried per-record so a card cannot render an event without its hedge.
    caveat: preset.caveat,
  };
}

/**
 * Normalize a GFW events response.
 *
 * Ordered longest-first: for gaps and loitering, duration is the signal — a
 * twelve-hour AIS gap is a different thing from a twenty-minute one.
 *
 * @param {object} payload Raw response.
 * @param {object} preset Preset descriptor.
 * @param {object} [options]
 * @returns {{events:Array<object>, truncated:boolean, total:number|null}}
 */
export function normalizeVesselEvents(payload, preset, { maxEvents = 600 } = {}) {
  const raw = Array.isArray(payload?.entries)
    ? payload.entries
    : (Array.isArray(payload) ? payload : []);
  const events = [];
  for (let i = 0; i < raw.length; i += 1) {
    const event = normalizeVesselEvent(raw[i], preset, i);
    if (event) events.push(event);
  }
  events.sort((a, b) => (b.durationHours ?? 0) - (a.durationHours ?? 0));
  const truncated = events.length > maxEvents;
  return {
    events: truncated ? events.slice(0, maxEvents) : events,
    truncated,
    total: finiteOrNull(payload?.total) ?? events.length,
  };
}

/**
 * Marker size for an event, scaled by duration where duration is meaningful.
 * @param {number|null} hours Event duration.
 * @returns {number} Pixel size.
 */
export function eventPixelSize(hours) {
  const value = finiteOrNull(hours);
  if (value === null || value <= 0) return 6;
  // Saturates around a fortnight; beyond that the difference stops being
  // legible and the dot would just eat the map.
  const ratio = Math.min(1, Math.log(1 + value) / Math.log(1 + 336));
  return Math.round(6 + ratio * 10);
}
