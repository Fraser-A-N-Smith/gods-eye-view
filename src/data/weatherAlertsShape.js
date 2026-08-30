/**
 * @module data/weatherAlertsShape
 * @description Normalization for NWS active alerts and NHC tropical cyclones.
 *
 * Pure module shared by the `/api/weather-alerts` and `/api/tropical-cyclones`
 * proxies and the layers that render them.
 *
 * ## The zone-geometry problem, which is the whole reason this file is careful
 *
 * A large share of NWS alerts carry `geometry: null`. They are issued against
 * named forecast zones or counties rather than a drawn polygon, and the API
 * returns the zone as a URL reference instead of a shape. Those alerts are
 * REAL and often the most serious ones — they simply cannot be drawn from this
 * payload alone.
 *
 * The dangerous failure is to silently drop them, because the map then shows
 * fewer warnings than exist and reads as an all-clear over places that are
 * under one. So they are counted, kept, and surfaced separately: the layer
 * reports "N drawn, M zone-only", and the zone-only ones are never rounded
 * away.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/** NWS severity ordering, most severe first. */
export const ALERT_SEVERITIES = Object.freeze(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);

/** Colour per severity. */
export const SEVERITY_STYLE = Object.freeze({
  Extreme: { css: '#ff2d55', label: 'EXTREME' },
  Severe: { css: '#ff7a1a', label: 'SEVERE' },
  Moderate: { css: '#ffd23f', label: 'MODERATE' },
  Minor: { css: '#38e1ff', label: 'MINOR' },
  Unknown: { css: '#9aa7b4', label: 'UNKNOWN' },
});

/**
 * Style for an alert severity, defaulting to Unknown rather than to Minor.
 * @param {string} severity NWS severity string.
 * @returns {{css:string, label:string, rank:number}}
 */
export function severityStyle(severity) {
  const key = ALERT_SEVERITIES.includes(severity) ? severity : 'Unknown';
  return { ...SEVERITY_STYLE[key], rank: ALERT_SEVERITIES.indexOf(key) };
}

/** Extract outer rings from a GeoJSON geometry; returns [] for null geometry. */
export function alertRings(geometry) {
  const rings = [];
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return rings;
  const take = (polygon) => {
    if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) return;
    const ring = polygon[0];
    if (Array.isArray(ring) && ring.length >= 4) rings.push(ring);
  };
  if (geometry.type === 'Polygon') take(coordinates);
  else if (geometry.type === 'MultiPolygon') for (const polygon of coordinates) take(polygon);
  return rings;
}

/**
 * Normalize one NWS alert feature.
 *
 * Always returns a record, even with no geometry — see the module note. The
 * `drawable` flag is what the renderer keys on, and the count of non-drawable
 * records is what the status line must report.
 *
 * @param {object} feature GeoJSON feature from /alerts/active.
 * @param {number} index Fallback identity.
 * @returns {object|null} Record, or null when there is no alert at all.
 */
export function normalizeAlert(feature, index = 0) {
  const properties = feature?.properties;
  if (!properties) return null;
  const rings = alertRings(feature.geometry);
  const severity = textOrNull(properties.severity) || 'Unknown';
  return {
    id: textOrNull(properties.id) || textOrNull(feature.id) || `alert-${index}`,
    event: textOrNull(properties.event) || 'WEATHER ALERT',
    severity: ALERT_SEVERITIES.includes(severity) ? severity : 'Unknown',
    urgency: textOrNull(properties.urgency),
    certainty: textOrNull(properties.certainty),
    headline: textOrNull(properties.headline),
    areaDesc: textOrNull(properties.areaDesc),
    sender: textOrNull(properties.senderName),
    effective: textOrNull(properties.effective),
    expires: textOrNull(properties.expires),
    rings,
    // The distinction the module exists to preserve.
    drawable: rings.length > 0,
  };
}

/**
 * Normalize an NWS alert collection.
 *
 * Sorted by severity so that, when the cap binds, what is dropped is the least
 * severe rather than an arbitrary tail.
 *
 * @param {object} collection GeoJSON FeatureCollection.
 * @param {object} [options]
 * @returns {{alerts:Array<object>, drawable:number, zoneOnly:number, truncated:boolean, total:number}}
 */
export function normalizeAlertCollection(collection, { maxAlerts = 500 } = {}) {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const records = [];
  for (let i = 0; i < features.length; i += 1) {
    const record = normalizeAlert(features[i], i);
    if (record) records.push(record);
  }
  records.sort((a, b) => severityStyle(a.severity).rank - severityStyle(b.severity).rank);
  const truncated = records.length > maxAlerts;
  const kept = truncated ? records.slice(0, maxAlerts) : records;
  let drawable = 0;
  for (const record of kept) if (record.drawable) drawable += 1;
  return {
    alerts: kept,
    drawable,
    // Counted, never silently discarded: a warning that cannot be drawn is
    // still a warning in force.
    zoneOnly: kept.length - drawable,
    truncated,
    total: records.length,
  };
}

/**
 * Saffir–Simpson category from maximum sustained wind in knots.
 * @param {number} windKt Max sustained wind, knots.
 * @returns {{category:string, css:string, rank:number}}
 */
export function cycloneCategory(windKt) {
  const wind = finiteOrNull(windKt);
  if (wind === null) return { category: 'UNKNOWN', css: '#9aa7b4', rank: -1 };
  if (wind >= 137) return { category: 'CAT 5', css: '#c724b1', rank: 5 };
  if (wind >= 113) return { category: 'CAT 4', css: '#ff2d55', rank: 4 };
  if (wind >= 96) return { category: 'CAT 3', css: '#ff4d3d', rank: 3 };
  if (wind >= 83) return { category: 'CAT 2', css: '#ff7a1a', rank: 2 };
  if (wind >= 64) return { category: 'CAT 1', css: '#ff9838', rank: 1 };
  if (wind >= 34) return { category: 'TROPICAL STORM', css: '#ffd23f', rank: 0 };
  return { category: 'TROPICAL DEPRESSION', css: '#38e1ff', rank: 0 };
}

/**
 * Normalize one NHC active-storm record.
 *
 * Field names differ between NHC products, so the lookups are alias-tolerant
 * in the same way the wildfire perimeters are.
 *
 * @param {object} storm Raw storm entry.
 * @param {number} index Fallback identity.
 * @returns {object|null}
 */
export function normalizeCyclone(storm, index = 0) {
  if (!storm) return null;
  const lat = finiteOrNull(storm.latitudeNumeric ?? storm.lat ?? storm.latitude);
  const lon = finiteOrNull(storm.longitudeNumeric ?? storm.lon ?? storm.longitude);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const windKt = finiteOrNull(storm.intensity ?? storm.intensityKt ?? storm.maxWindKt);
  return {
    id: textOrNull(storm.id) || textOrNull(storm.binNumber) || `cyclone-${index}`,
    name: textOrNull(storm.name) || 'UNNAMED SYSTEM',
    basin: textOrNull(storm.basinId ?? storm.basin),
    classification: textOrNull(storm.classification),
    lat,
    lon,
    windKt,
    pressureMb: finiteOrNull(storm.pressure ?? storm.pressureMb),
    movementDir: finiteOrNull(storm.movementDir),
    movementSpeedKt: finiteOrNull(storm.movementSpeed),
    lastUpdate: textOrNull(storm.lastUpdate ?? storm.lastUpdated),
  };
}

/**
 * Normalize an NHC active-storms payload.
 * @param {object|Array} payload Raw CurrentStorms-style payload.
 * @returns {{storms:Array<object>, total:number}}
 */
export function normalizeCyclones(payload) {
  const raw = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.activeStorms) ? payload.activeStorms : []);
  const storms = [];
  for (let i = 0; i < raw.length; i += 1) {
    const storm = normalizeCyclone(raw[i], i);
    if (storm) storms.push(storm);
  }
  storms.sort((a, b) => cycloneCategory(b.windKt).rank - cycloneCategory(a.windKt).rank);
  return { storms, total: raw.length };
}
