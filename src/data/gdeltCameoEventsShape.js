/**
 * @module data/gdeltCameoEventsShape
 * @description Parsing, presets, and rolling-buffer logic for the GDELT Event
 * Database 2.0 layer. Pure module, shared by the `/api/gdelt/cameo-events`
 * proxy and the client layer, so the two cannot disagree about a record's
 * shape.
 *
 * ## Why this is a different dataset from the GEO 2.0 mentions layer
 *
 * The existing `gdeltEventsShape.js` layer draws PLACES MENTIONED in matching
 * news coverage — high recall, no claim about what happened. This module
 * parses GDELT's actual Event Database: CAMEO-coded, actor/action-geocoded
 * records extracted from the same underlying article stream. It is still
 * machine-extracted from news text, not human-vetted, so records here are
 * "reported events," never "events" — same discipline as the mentions layer.
 *
 * ## The export format has no header row
 *
 * Unlike GDELT's GEO/DOC REST APIs, the Event 2.0 database is published only
 * as bulk 15-minute exports — tab-delimited, misnamed `.CSV`, zipped, one
 * file for the whole world, no server-side event-type filter. The file has
 * NO header row: columns are positional, per the published GDELT 2.0 Event
 * codebook (stable since 2015). `EVENT_COLUMNS` below is that layout.
 *
 * ## Closed preset allowlist, same as the mentions layer
 *
 * `CAMEO_PRESETS` maps a small, fixed set of CAMEO root event codes to named
 * themes. `resolveCameoPreset` refuses anything not in the table — there is
 * no code path that turns this into free-text or actor-name search.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/** 0-indexed column positions in a GDELT 2.0 Event export row (61 fields, tab-delimited). */
export const EVENT_COLUMNS = Object.freeze({
  GLOBALEVENTID: 0,
  EVENT_ROOT_CODE: 28,
  QUAD_CLASS: 29,
  GOLDSTEIN_SCALE: 30,
  NUM_MENTIONS: 31,
  ACTOR1_GEO_TYPE: 35,
  ACTOR1_GEO_LAT: 40,
  ACTOR1_GEO_LONG: 41,
  ACTION_GEO_TYPE: 51,
  ACTION_GEO_LAT: 56,
  ACTION_GEO_LONG: 57,
  DATEADDED: 59,
  SOURCEURL: 60,
});

/** Minimum column count a row must have to be worth reading. */
export const MIN_EVENT_COLUMNS = 61;

/**
 * `ActionGeo_Type` / `Actor1Geo_Type` resolution codes, per the GDELT geo
 * codebook: 1=COUNTRY, 2=USSTATE, 3=USCITY, 4=WORLDCITY, 5=WORLDSTATE.
 * Mapped to an honest precision label so a country-level dot never reads as
 * street-level.
 */
const GEO_TYPE_PRECISION = Object.freeze({
  1: 'country',
  2: 'region',
  3: 'locality',
  4: 'locality',
  5: 'region',
});

/**
 * Precision label for a geo-type code.
 * @param {*} geoType Raw ActionGeo_Type/Actor1Geo_Type value.
 * @returns {string} One of 'country'/'region'/'locality'/'unknown'.
 */
export function geoPrecisionFor(geoType) {
  const code = finiteOrNull(geoType);
  if (code === null) return 'unknown';
  return GEO_TYPE_PRECISION[code] || 'unknown';
}

/**
 * Selectable event themes. `rootCodes` are GDELT CAMEO root event codes
 * (2-digit strings, zero-padded) — not free text, not actor names.
 */
export const CAMEO_PRESETS = Object.freeze([
  Object.freeze({
    id: 'unrest',
    label: 'UNREST',
    rootCodes: Object.freeze(['14']),
    description: 'Reported protest events, trailing buffer window',
    accent: '#ffd23f',
  }),
  Object.freeze({
    id: 'conflict',
    label: 'CONFLICT',
    rootCodes: Object.freeze(['18', '19', '20']),
    description: 'Reported assault, fight, and mass-violence events',
    accent: '#ff4d3d',
  }),
  Object.freeze({
    id: 'diplomacy',
    label: 'DIPLOMACY',
    rootCodes: Object.freeze(['03', '04']),
    description: 'Reported intent-to-cooperate and consultation events',
    accent: '#38b6ff',
  }),
]);

/** Default preset when none is chosen. */
export const DEFAULT_CAMEO_PRESET_ID = 'unrest';

const PRESETS_BY_ID = new Map(CAMEO_PRESETS.map((preset) => [preset.id, preset]));

/** Every valid preset id. */
export const CAMEO_PRESET_IDS = Object.freeze(CAMEO_PRESETS.map((preset) => preset.id));

/** Union of every root code any preset cares about — the parse-time keep-list. */
export const RELEVANT_ROOT_CODES = Object.freeze([
  ...new Set(CAMEO_PRESETS.flatMap((preset) => preset.rootCodes)),
]);
const RELEVANT_ROOT_CODE_SET = new Set(RELEVANT_ROOT_CODES);

/**
 * Resolve a preset id to its descriptor. Returns null for anything unknown —
 * callers must treat null as a refusal, not "fall back to something".
 * @param {string} id Preset id.
 * @returns {object|null}
 */
export function resolveCameoPreset(id) {
  if (typeof id !== 'string') return null;
  return PRESETS_BY_ID.get(id) || null;
}

/**
 * Whether a raw EventRootCode is one this layer keeps at all (any preset).
 * @param {string} rootCode Two-digit CAMEO root code.
 * @returns {boolean}
 */
export function isRelevantRootCode(rootCode) {
  return typeof rootCode === 'string' && RELEVANT_ROOT_CODE_SET.has(rootCode);
}

/**
 * Parse DATEADDED (14-digit `YYYYMMDDHHMMSS`, UTC) into epoch milliseconds.
 * @param {string} value Raw DATEADDED field.
 * @returns {number} Epoch ms, or NaN when unparseable.
 */
export function dateAddedMsUtc(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{14}$/.test(text)) return NaN;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const hour = Number(text.slice(8, 10));
  const minute = Number(text.slice(10, 12));
  const second = Number(text.slice(12, 14));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return NaN;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Format an epoch-ms timestamp as a GDELT 15-minute interval id
 * (`YYYYMMDDHHMMSS`, UTC, seconds always `00`).
 * @param {number} ms Epoch milliseconds.
 * @returns {string}
 */
export function formatIntervalId(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00`
  );
}

/**
 * Parse a GDELT interval id (`YYYYMMDDHHMMSS`) into epoch milliseconds.
 * @param {string} id14 Interval id.
 * @returns {number} Epoch ms, or NaN when unparseable.
 */
export function parseIntervalId(id14) {
  return dateAddedMsUtc(id14);
}

/** GDELT's publish cadence — every 15 minutes. */
export const INTERVAL_STEP_MS = 15 * 60 * 1000;

/**
 * The interval id `stepsBack` publish-cycles before `id14`.
 * @param {string} id14 Interval id.
 * @param {number} [stepsBack] Number of 15-minute steps to go back.
 * @returns {string|null} Interval id, or null when `id14` is unparseable.
 */
export function previousIntervalId(id14, stepsBack = 1) {
  const ms = parseIntervalId(id14);
  if (!Number.isFinite(ms)) return null;
  return formatIntervalId(ms - stepsBack * INTERVAL_STEP_MS);
}

/**
 * The bulk export URL for a given interval id.
 * @param {string} id14 Interval id.
 * @returns {string}
 */
export function exportUrlForInterval(id14) {
  return `https://data.gdeltproject.org/gdeltv2/${id14}.export.CSV.zip`;
}

/**
 * Extract the `.export.CSV.zip` line from `lastupdate.txt` (three
 * space-separated `size md5 url` lines: export, mentions, gkg — in that
 * order, but this reads by suffix rather than trusting line order).
 * @param {string} text Raw `lastupdate.txt` body.
 * @returns {{url: string, intervalId: string}|null}
 */
export function parseLastUpdateText(text) {
  if (typeof text !== 'string') return null;
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const url = parts[parts.length - 1];
    if (url && url.endsWith('.export.CSV.zip')) {
      const filename = url.slice(url.lastIndexOf('/') + 1);
      const intervalId = filename.slice(0, 14);
      if (!/^\d{14}$/.test(intervalId)) continue;
      return { url, intervalId };
    }
  }
  return null;
}

/**
 * Parse one tab-delimited event row into a compact record.
 *
 * Drops the row unless: it has enough columns to be a real export row, its
 * EventRootCode is one this layer cares about (see `RELEVANT_ROOT_CODES`),
 * and it has a usable position — `ActionGeo` first, falling back to
 * `Actor1Geo` when the action itself has no resolved location.
 *
 * @param {string} line Raw tab-delimited row (no trailing newline).
 * @returns {object|null}
 */
export function parseCameoEventRow(line) {
  if (typeof line !== 'string' || !line) return null;
  const fields = line.split('\t');
  if (fields.length < MIN_EVENT_COLUMNS) return null;

  const rootCode = textOrNull(fields[EVENT_COLUMNS.EVENT_ROOT_CODE]);
  if (!isRelevantRootCode(rootCode)) return null;

  let lat = finiteOrNull(fields[EVENT_COLUMNS.ACTION_GEO_LAT]);
  let lon = finiteOrNull(fields[EVENT_COLUMNS.ACTION_GEO_LONG]);
  let geoType = fields[EVENT_COLUMNS.ACTION_GEO_TYPE];
  if (lat === null || lon === null) {
    lat = finiteOrNull(fields[EVENT_COLUMNS.ACTOR1_GEO_LAT]);
    lon = finiteOrNull(fields[EVENT_COLUMNS.ACTOR1_GEO_LONG]);
    geoType = fields[EVENT_COLUMNS.ACTOR1_GEO_TYPE];
  }
  if (lat === null || lon === null) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;

  const globalEventId = textOrNull(fields[EVENT_COLUMNS.GLOBALEVENTID]);
  const dateMs = dateAddedMsUtc(fields[EVENT_COLUMNS.DATEADDED]);

  return {
    id: `gdelt-cameo-${globalEventId || `${lon.toFixed(3)},${lat.toFixed(3)}-${rootCode}`}`,
    lat,
    lon,
    rootCode,
    quadClass: finiteOrNull(fields[EVENT_COLUMNS.QUAD_CLASS]),
    goldstein: finiteOrNull(fields[EVENT_COLUMNS.GOLDSTEIN_SCALE]),
    numMentions: finiteOrNull(fields[EVENT_COLUMNS.NUM_MENTIONS]) ?? 1,
    sourceUrl: textOrNull(fields[EVENT_COLUMNS.SOURCEURL]),
    dateMs: Number.isFinite(dateMs) ? dateMs : null,
    precision: geoPrecisionFor(geoType),
  };
}

/**
 * Parse a full export body into relevant, positioned records. Tolerant of
 * CRLF, trailing newlines, and malformed rows (skipped individually).
 * @param {string} text Raw tab-delimited export body.
 * @returns {Array<object>} Records — empty array for an empty/malformed body.
 */
export function parseCameoExport(text) {
  if (typeof text !== 'string' || !text) return [];
  const records = [];
  for (const line of text.split('\n')) {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!trimmed) continue;
    const record = parseCameoEventRow(trimmed);
    if (record) records.push(record);
  }
  return records;
}

/**
 * Drop buffered intervals older than the rolling window.
 * @param {Array<{intervalId: string, intervalMs: number, records: Array<object>}>} entries Buffer.
 * @param {number} nowMs Reference time.
 * @param {number} windowMs Window size — entries older than this are dropped.
 * @returns {Array<object>} Surviving entries, in original order.
 */
export function pruneStaleIntervals(entries, nowMs, windowMs) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => Number.isFinite(entry?.intervalMs) && nowMs - entry.intervalMs <= windowMs);
}

/**
 * Flatten buffered intervals into one record list, deduping by id (a
 * GLOBALEVENTID can reappear across intervals if GDELT reprocesses it — the
 * most recently buffered copy wins).
 * @param {Array<{records: Array<object>}>} entries Buffer.
 * @returns {Array<object>}
 */
export function mergeIntervalRecords(entries) {
  if (!Array.isArray(entries)) return [];
  const byId = new Map();
  for (const entry of entries) {
    for (const record of entry?.records || []) {
      if (record?.id) byId.set(record.id, record);
    }
  }
  return [...byId.values()];
}

/**
 * Slice a merged record set down to one preset, capped and ordered by
 * mention count so a bound cap keeps the most-reported records.
 * @param {Array<object>} records Merged buffer records.
 * @param {string} presetId Preset id.
 * @param {{maxRecords?: number}} [options]
 * @returns {{records: Array<object>, truncated: boolean, totalFeatures: number}}
 */
export function sliceRecordsForPreset(records, presetId, { maxRecords = 750 } = {}) {
  const preset = resolveCameoPreset(presetId);
  if (!preset || !Array.isArray(records)) return { records: [], truncated: false, totalFeatures: 0 };
  const rootCodes = new Set(preset.rootCodes);
  const matched = records.filter((record) => rootCodes.has(record.rootCode));
  matched.sort((a, b) => (b.numMentions ?? 0) - (a.numMentions ?? 0));
  const truncated = matched.length > maxRecords;
  return {
    records: truncated ? matched.slice(0, maxRecords) : matched,
    truncated,
    totalFeatures: matched.length,
  };
}
