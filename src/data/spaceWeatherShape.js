/**
 * @module data/spaceWeatherShape
 * @description Normalization for NOAA SWPC space-weather products.
 *
 * Pure module shared by the `/api/space-weather` proxy and the layer.
 *
 * ## Why this layer connects others
 *
 * Space weather is the one input that changes what several existing layers
 * MEAN. A geomagnetic storm is simultaneously HF radio propagation collapse
 * (the radio layer), increased satellite drag and orbit uncertainty (the
 * satellites layer), and GNSS position degradation (everything that reports a
 * position). The layer therefore surfaces the operational consequence
 * alongside the number, because "Kp 7" is not a fact most people can act on.
 *
 * ## OVATION is a model, not an observation
 *
 * The aurora grid is a 30–90 minute FORECAST produced by the OVATION model
 * from solar wind measured at L1, roughly a million miles upstream. It is a
 * prediction of probability, not a picture of what is currently glowing, and
 * the layer is required to say so.
 */

import { finiteOrNull } from './numeric.js';

/** Kp bands, with what each actually means for the other layers. */
export const KP_BANDS = Object.freeze([
  Object.freeze({ min: 0, label: 'QUIET', css: '#4ade80', effect: 'No operational impact' }),
  Object.freeze({ min: 4, label: 'UNSETTLED', css: '#ffd23f', effect: 'Minor HF fading at high latitudes' }),
  Object.freeze({ min: 5, label: 'G1 STORM', css: '#ff9838', effect: 'HF degraded, aurora visible to ~60° latitude' }),
  Object.freeze({ min: 6, label: 'G2 STORM', css: '#ff7a1a', effect: 'HF fadeouts, satellite drag rising, GNSS error up' }),
  Object.freeze({ min: 7, label: 'G3 STORM', css: '#ff4d3d', effect: 'HF intermittent, orbit predictions degrade, GNSS unreliable' }),
  Object.freeze({ min: 8, label: 'G4 STORM', css: '#ff2d55', effect: 'Widespread HF blackout, significant drag, GNSS unusable for hours' }),
  Object.freeze({ min: 9, label: 'G5 STORM', css: '#c724b1', effect: 'HF blackout, grid and satellite operations at risk' }),
]);

/**
 * Classify a planetary K-index.
 * @param {number} kp Planetary K-index, 0–9.
 * @returns {{label:string, css:string, effect:string, kp:number|null}}
 */
export function classifyKp(kp) {
  const value = finiteOrNull(kp);
  if (value === null) {
    return { label: 'UNKNOWN', css: '#9aa7b4', effect: 'No current index available', kp: null };
  }
  const clamped = Math.min(9, Math.max(0, value));
  let band = KP_BANDS[0];
  for (const candidate of KP_BANDS) if (clamped >= candidate.min) band = candidate;
  return { label: band.label, css: band.css, effect: band.effect, kp: clamped };
}

/**
 * Parse the OVATION aurora grid.
 *
 * SWPC ships `coordinates` as `[longitude, latitude, aurora]` triples on a
 * 1°×1° global grid — about 65,000 points, the overwhelming majority of them
 * zero. Anything at or below `minProbability` is dropped here rather than in
 * the renderer: pushing 65k invisible primitives at the GPU to then not see
 * them is the expensive way to draw nothing.
 *
 * Longitudes arrive in 0–360 and are wrapped to −180…180, which is what Cesium
 * expects; skipping that puts the entire eastern hemisphere's aurora in the
 * wrong place.
 *
 * @param {object} payload Parsed ovation_aurora_latest.json.
 * @param {object} [options]
 * @returns {{points: Array<object>, observedAt: string|null, forecastAt: string|null, peak: number, dropped: number}}
 */
export function parseAuroraGrid(payload, { minProbability = 8, maxPoints = 9000 } = {}) {
  const raw = Array.isArray(payload?.coordinates) ? payload.coordinates : [];
  const points = [];
  let peak = 0;
  let dropped = 0;

  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const probability = finiteOrNull(entry[2]);
    if (probability === null || probability < minProbability) {
      dropped += 1;
      continue;
    }
    const rawLon = finiteOrNull(entry[0]);
    const lat = finiteOrNull(entry[1]);
    if (rawLon === null || lat === null) continue;
    if (lat < -90 || lat > 90) continue;
    const lon = rawLon > 180 ? rawLon - 360 : rawLon;
    if (lon < -180 || lon > 180) continue;
    points.push({ lon, lat, probability });
    if (probability > peak) peak = probability;
  }

  // Brightest first, so a cap keeps the visible oval rather than its fringe.
  points.sort((a, b) => b.probability - a.probability);
  return {
    points: points.length > maxPoints ? points.slice(0, maxPoints) : points,
    observedAt: typeof payload?.["Observation Time"] === 'string' ? payload['Observation Time'] : null,
    forecastAt: typeof payload?.['Forecast Time'] === 'string' ? payload['Forecast Time'] : null,
    peak,
    dropped,
  };
}

/**
 * Read the latest planetary K-index from SWPC's array-of-arrays product.
 *
 * The product is a CSV-shaped JSON array whose first row is a header. Rows are
 * appended over time, so the LAST row is current — reading the first data row
 * would report a value up to a week old.
 *
 * @param {Array<Array<string>>} payload Parsed noaa-planetary-k-index.json.
 * @returns {{kp: number|null, timeTag: string|null}}
 */
export function parsePlanetaryKp(payload) {
  if (!Array.isArray(payload) || payload.length < 2) return { kp: null, timeTag: null };
  const header = payload[0];
  if (!Array.isArray(header)) return { kp: null, timeTag: null };
  const kpIndex = header.findIndex((name) => /kp/i.test(String(name)));
  const timeIndex = header.findIndex((name) => /time/i.test(String(name)));
  for (let i = payload.length - 1; i >= 1; i -= 1) {
    const row = payload[i];
    if (!Array.isArray(row)) continue;
    const kp = finiteOrNull(row[kpIndex >= 0 ? kpIndex : 1]);
    if (kp === null) continue;
    return { kp, timeTag: timeIndex >= 0 ? String(row[timeIndex] ?? '') || null : null };
  }
  return { kp: null, timeTag: null };
}

/**
 * Aurora probability → display colour and size.
 * @param {number} probability 0–100.
 * @returns {{css:string, alpha:number, pixelSize:number}}
 */
export function auroraStyle(probability) {
  const value = finiteOrNull(probability);
  if (value === null || value <= 0) return { css: '#00ff88', alpha: 0, pixelSize: 0 };
  const scaled = Math.min(100, value) / 100;
  // Green through to magenta, mirroring how real aurora shifts colour with
  // intensity rather than an arbitrary heat ramp.
  const css = scaled > 0.66 ? '#e879f9' : (scaled > 0.33 ? '#a3e635' : '#00ff88');
  return {
    css,
    alpha: Math.min(0.85, 0.18 + scaled * 0.7),
    pixelSize: Math.round(3 + scaled * 6),
  };
}
