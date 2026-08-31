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

import { finiteOrNull, textOrNull } from './numeric.js';

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
 * Pull a panel-sized summary out of a DONKI message body.
 *
 * `messageBody` is long free text intended for an email digest, often several
 * paragraphs with a `## Summary:` heading. The panel gets one sentence, not
 * the digest: the paragraph under that heading if present, else the first
 * ~200 characters.
 *
 * @param {*} body Raw `messageBody` field.
 * @returns {string}
 */
function extractDonkiSummary(body) {
  const text = textOrNull(body);
  if (!text) return '';
  const heading = /##\s*Summary:?/i.exec(text);
  if (heading) {
    // Real DONKI bodies put a blank line between the heading and its
    // paragraph ("## Summary:\n\nC-type CME detected..."); without stripping
    // that leading blank line first, the paragraph-end search matches it
    // immediately and returns an empty string.
    const rest = text.slice(heading.index + heading[0].length).replace(/^\s+/, '');
    const paragraphEnd = rest.search(/\n\s*\n|\n##/);
    const paragraph = (paragraphEnd >= 0 ? rest.slice(0, paragraphEnd) : rest).trim();
    if (paragraph) return paragraph.slice(0, 200);
  }
  return text.slice(0, 200).trim();
}

/**
 * Parse DONKI (Database Of Notifications, Knowledge, Information) CME/flare
 * notifications into panel-sized events.
 *
 * @param {*} payload Parsed DONKI `/DONKI/notifications` response.
 * @param {object} [options]
 * @param {number} [options.maxItems] Cap on returned events.
 * @returns {Array<{id:string, type:string, issuedMs:number, summary:string, url:string|null}>}
 */
export function parseDonkiNotifications(payload, { maxItems = 20 } = {}) {
  const raw = Array.isArray(payload) ? payload : [];
  const events = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const type = textOrNull(entry.messageType);
    const id = textOrNull(entry.messageID);
    const issuedMs = typeof entry.messageIssueTime === 'string' ? Date.parse(entry.messageIssueTime) : NaN;
    if (!type || !id || !Number.isFinite(issuedMs)) continue;
    events.push({
      id,
      type,
      issuedMs,
      summary: extractDonkiSummary(entry.messageBody),
      url: textOrNull(entry.messageURL),
    });
  }
  // Newest first — a week of notifications is a scroll, not a feed to read
  // bottom-up.
  events.sort((a, b) => b.issuedMs - a.issuedMs);
  return events.slice(0, maxItems);
}

/**
 * Parse a single-day NeoWs feed into close-approach records.
 *
 * The feed is keyed by date; a single-day query still nests one array under
 * that date's key, so this flattens across whatever keys are present rather
 * than assuming today's date string matches exactly (timezone skew between
 * client and upstream can otherwise produce an empty grab of the right day).
 * Each object carries exactly one `close_approach_data` entry for a
 * single-day query, so the first is the relevant one. These bodies have no
 * Earth surface coordinate — there is nowhere on the globe to place them —
 * which is why they live in this panel rather than as map entities.
 *
 * @param {*} payload Parsed NeoWs `/neo/rest/v1/feed` response.
 * @param {object} [options]
 * @param {number} [options.maxItems] Cap on returned approaches.
 * @returns {Array<{id:string, name:string, missDistanceKm:number, velocityKmS:number|null, diameterMinM:number|null, diameterMaxM:number|null, hazardous:boolean, closeApproachMs:number|null}>}
 */
export function parseNeoFeed(payload, { maxItems = 20 } = {}) {
  const byDate = payload?.near_earth_objects;
  const objects = [];
  if (byDate && typeof byDate === 'object') {
    for (const list of Object.values(byDate)) {
      if (Array.isArray(list)) objects.push(...list);
    }
  }

  const approaches = [];
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    const id = textOrNull(obj.id);
    if (!id) continue;
    const approach = Array.isArray(obj.close_approach_data) ? obj.close_approach_data[0] : null;
    const missDistanceKm = finiteOrNull(approach?.miss_distance?.kilometers);
    if (missDistanceKm === null) continue;
    approaches.push({
      id,
      name: textOrNull(obj.name) || id,
      missDistanceKm,
      velocityKmS: finiteOrNull(approach?.relative_velocity?.kilometers_per_second),
      diameterMinM: finiteOrNull(obj?.estimated_diameter?.meters?.estimated_diameter_min),
      diameterMaxM: finiteOrNull(obj?.estimated_diameter?.meters?.estimated_diameter_max),
      hazardous: obj.is_potentially_hazardous_asteroid === true,
      closeApproachMs: finiteOrNull(approach?.epoch_date_close_approach),
    });
  }

  // Closest first — the interesting ones, and what a "close approach" panel
  // implies by name.
  approaches.sort((a, b) => a.missDistanceKm - b.missDistanceKm);
  return approaches.slice(0, maxItems);
}

/**
 * Parse today's NOAA radio-blackout (R) scale out of the `noaa-scales.json`
 * product, which reports today plus a 3-day forecast keyed `"0"`..`"3"`.
 *
 * @param {*} payload Parsed `noaa-scales.json` response.
 * @returns {{scale:string|null, text:string|null}|null} `null` only when
 *   today's `R` entry itself is missing — an entry with a null Scale (no
 *   current blackout) is still a real reading, not an absent one.
 */
export function parseRadioBlackoutScale(payload) {
  const today = payload && typeof payload === 'object' ? payload['0'] : null;
  const r = today && typeof today === 'object' ? today.R : null;
  if (!r || typeof r !== 'object') return null;
  return { scale: textOrNull(r.Scale), text: textOrNull(r.Text) };
}

/**
 * Parse the NASA JPL Sentry impact-risk summary list.
 *
 * Sentry is a STANDING risk table (which currently-known objects have a
 * nonzero cumulative impact probability over the whole span JPL has
 * computed), not an event feed — unlike NeoWs above, there is no "today"
 * here. Confidence note: the summary endpoint's exact field names were
 * confirmed against indexed API documentation, not a live raw response, in
 * the research session that produced this task (this sandbox's egress
 * policy blocks ssd-api.jpl.nasa.gov directly) — verify the response shape
 * against a live request before trusting this in production.
 *
 * Field names per JPL's SentryObject: `des` (designation), `fullname`,
 * `diameter` (km), `ip` (cumulative impact probability), `ps_cum`
 * (cumulative Palermo Scale), `ts_max` (max Torino Scale), `v_inf` (impact
 * velocity, km/s), `last_obs` (last observation date). No Earth-surface
 * coordinate — same reasoning NeoWs close approaches are panel-only, not
 * globe entities.
 *
 * @param {*} payload Parsed `sentry.api` summary-list response.
 * @param {object} [options]
 * @param {number} [options.maxItems] Cap on returned objects.
 * @returns {Array<{designation:string, fullname:string|null, diameterKm:number|null,
 *   impactProbability:number|null, palermoScale:number|null, torinoScale:number|null,
 *   velocityKmS:number|null, lastObservedDate:string|null}>}
 */
export function parseSentryRiskList(payload, { maxItems = 20 } = {}) {
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  const objects = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const designation = textOrNull(entry.des);
    if (!designation) continue;
    objects.push({
      designation,
      fullname: textOrNull(entry.fullname),
      diameterKm: finiteOrNull(entry.diameter),
      impactProbability: finiteOrNull(entry.ip),
      palermoScale: finiteOrNull(entry.ps_cum),
      torinoScale: finiteOrNull(entry.ts_max),
      velocityKmS: finiteOrNull(entry.v_inf),
      lastObservedDate: textOrNull(entry.last_obs),
    });
  }
  // Highest cumulative impact probability first — the reason a "risk" table
  // gets read at all. Objects with no reported ip sort last, not first.
  objects.sort((a, b) => (b.impactProbability ?? -1) - (a.impactProbability ?? -1));
  return objects.slice(0, maxItems);
}

/**
 * Read the latest row of one NOAA SWPC solar-wind product
 * (`plasma-7-day.json` or `mag-7-day.json`).
 *
 * Same shape family as `parsePlanetaryKp` above: a CSV-like array of arrays
 * whose first row is a header, appended over time, so the LAST row is
 * current. Columns are read BY HEADER NAME, not fixed position, so an
 * upstream column reorder fails a test here rather than silently
 * mis-mapping a field (same discipline `parsePlanetaryKp` already
 * established for this reason).
 *
 * @param {Array<Array<string>>} payload Parsed plasma-7-day.json or mag-7-day.json.
 * @param {Array<string>} columnNames Header names to read, in priority order tried per field.
 * @returns {{row: Array<string>|null, header: Array<string>|null}}
 */
function latestSolarWindRow(payload) {
  if (!Array.isArray(payload) || payload.length < 2) return { row: null, header: null };
  const header = payload[0];
  if (!Array.isArray(header)) return { row: null, header: null };
  const row = payload.at(-1);
  return Array.isArray(row) ? { row, header } : { row: null, header: null };
}

function columnValue(header, row, pattern) {
  const index = header.findIndex((name) => pattern.test(String(name)));
  return index >= 0 ? row[index] : undefined;
}

/**
 * Combine the latest plasma + magnetic-field rows into one "solar wind now"
 * reading. Either input may independently be unavailable (each is its own
 * `Promise.allSettled` branch in the proxy) — a missing plasma row nulls
 * only `speedKmS`/`density`, a missing mag row nulls only `bz`/`bt`, exactly
 * the same per-field independent-failure discipline the rest of this module
 * already applies to DONKI/NeoWs/NOAA-scales.
 *
 * @param {*} plasmaPayload Parsed plasma-7-day.json, or null if that fetch failed.
 * @param {*} magPayload Parsed mag-7-day.json, or null if that fetch failed.
 * @returns {{speedKmS:number|null, density:number|null, bz:number|null, bt:number|null, sampledAtMs:number|null}}
 */
export function parseSolarWindNow(plasmaPayload, magPayload) {
  const plasma = latestSolarWindRow(plasmaPayload);
  const mag = latestSolarWindRow(magPayload);
  const speedKmS = plasma.row ? finiteOrNull(columnValue(plasma.header, plasma.row, /^speed$/i)) : null;
  const density = plasma.row ? finiteOrNull(columnValue(plasma.header, plasma.row, /^density$/i)) : null;
  const bz = mag.row ? finiteOrNull(columnValue(mag.header, mag.row, /^bz_gsm$/i)) : null;
  const bt = mag.row ? finiteOrNull(columnValue(mag.header, mag.row, /^bt$/i)) : null;
  const plasmaTimeTag = plasma.row ? columnValue(plasma.header, plasma.row, /^time_tag$/i) : null;
  const magTimeTag = mag.row ? columnValue(mag.header, mag.row, /^time_tag$/i) : null;
  // Whichever product actually produced a row — a plasma-only or mag-only
  // outage should not blank the timestamp for the half that still arrived.
  const sampledAtMs = finiteOrNull(Date.parse(String(plasmaTimeTag ?? magTimeTag ?? '')));
  return { speedKmS, density, bz, bt, sampledAtMs };
}

/**
 * Merge the eight `Promise.allSettled` results from `spaceWeatherProxy`'s
 * upstream fan-out (aurora, Kp, DONKI, NeoWs, NOAA scales, Sentry, solar-wind
 * plasma, solar-wind mag) into the payload the client layer consumes.
 *
 * Pulled out of `vite.config.js` so the per-source independent-failure
 * guarantee — a DONKI/NeoWs/NOAA-scales/Sentry/plasma/mag rejection blanks
 * only its own field and never touches the aurora oval or Kp index, and (the
 * reverse) a rejection of any one optional source never blanks any of the
 * others — is a plain, directly unit-testable function rather than
 * something only verifiable by reading the proxy's closure. If that merge
 * step is ever refactored and accidentally lets one rejection blank another
 * source's data, a test here catches it; nothing else in this codebase
 * exercises a `refreshUpstream` merge step this way, which is exactly why
 * this one is worth pulling out.
 *
 * The aurora result is the sole exception to "independent": it is required,
 * so a rejected `auroraResult` re-throws its rejection reason here rather
 * than degrading — the proxy has nothing worth serving without it, and the
 * caller (`spaceWeatherProxy.refreshUpstream`) is expected to let that throw
 * propagate into its existing stale-cache/502 handling unchanged.
 *
 * @param {object} results
 * @param {PromiseSettledResult<*>} results.auroraResult
 * @param {PromiseSettledResult<*>} results.kpResult
 * @param {PromiseSettledResult<*>} results.donkiResult
 * @param {PromiseSettledResult<*>} results.neoResult
 * @param {PromiseSettledResult<*>} results.scalesResult
 * @param {PromiseSettledResult<*>} [results.sentryResult]
 * @param {PromiseSettledResult<*>} [results.plasmaResult]
 * @param {PromiseSettledResult<*>} [results.magResult]
 * @returns {object} The merged payload (pre-`JSON.stringify`; the proxy adds
 *   `attribution`/`fetchedAt` on top).
 * @throws {*} `auroraResult.reason` when the aurora fetch itself failed.
 */
export function mergeSpaceWeatherPayload({
  auroraResult, kpResult, donkiResult, neoResult, scalesResult,
  sentryResult, plasmaResult, magResult,
}) {
  if (auroraResult.status !== 'fulfilled') throw auroraResult.reason;
  const aurora = parseAuroraGrid(auroraResult.value);
  const kp = kpResult.status === 'fulfilled'
    ? parsePlanetaryKp(kpResult.value)
    : { kp: null, timeTag: null };
  const solarEvents = donkiResult.status === 'fulfilled'
    ? parseDonkiNotifications(donkiResult.value)
    : [];
  const closeApproaches = neoResult.status === 'fulfilled'
    ? parseNeoFeed(neoResult.value)
    : [];
  const radioBlackoutScale = scalesResult.status === 'fulfilled'
    ? parseRadioBlackoutScale(scalesResult.value)
    : null;
  const impactRiskObjects = sentryResult?.status === 'fulfilled'
    ? parseSentryRiskList(sentryResult.value)
    : [];
  const plasmaOk = plasmaResult?.status === 'fulfilled';
  const magOk = magResult?.status === 'fulfilled';
  // Both sources down (or both simply absent, e.g. an un-upgraded call site)
  // reads as no reading at all — null, not an all-null-fielded object —
  // matching the sibling convention `radioBlackoutScale` already uses when
  // its own single source fails.
  const solarWindNow = (plasmaOk || magOk)
    ? parseSolarWindNow(plasmaOk ? plasmaResult.value : null, magOk ? magResult.value : null)
    : null;

  return {
    aurora: aurora.points,
    auroraPeak: aurora.peak,
    observedAt: aurora.observedAt,
    forecastAt: aurora.forecastAt,
    gridDropped: aurora.dropped,
    kp: kp.kp,
    kpTimeTag: kp.timeTag,
    kpAvailable: kpResult.status === 'fulfilled',
    solarEvents,
    closeApproaches,
    radioBlackoutScale,
    impactRiskObjects,
    solarWindNow,
  };
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
