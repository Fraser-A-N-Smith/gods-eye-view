/**
 * @module data/internetOutagesShape
 * @description IODA/OONI filter and normalization rules for the Internet
 * Outages & Censorship layer.
 *
 * Pure module shared by the `/api/internet-outages` proxy (vite.config.js,
 * Node-only) and the Cesium-importing layer (internetOutages.js,
 * browser-only) — mirroring the existing `globalHazardsShape.js` precedent
 * for a two-upstream merge.
 *
 * Neither IODA's alert records nor OONI's per-country aggregate rows carry a
 * coordinate — both key by ISO 3166-1 alpha-2 country code. Both mappers
 * take a `countryCentroids` lookup (`config/country_centroids.json`, ISO
 * alpha-2 → `{name, lat, lon}`) and drop any row whose code has no entry
 * rather than guessing a placeholder location.
 *
 * ## Confidence note
 *
 * IODA's response shape (`entity.code`/`entity.name`/`entity.type`, `time`,
 * `level`, `datasource`, `value`, `historyValue`) is taken verbatim from
 * CAIDA's own published API specification
 * (github.com/CAIDA/ioda-api/wiki/API-Specification, cloned and read during
 * this task). OONI's shape (`result[]` rows keyed by the requested
 * `axis_x`, each carrying `anomaly_count`/`confirmed_count`/
 * `failure_count`/`measurement_count`) is taken from the OONI API's own
 * integration test suite (github.com/ooni/api,
 * `newapi/tests/integ/test_aggregation.py`). Both are higher-confidence than
 * the rest of this plan's tasks, which relied on search-indexed
 * documentation rather than the providers' own spec/test source — but
 * neither was exercised against a live response in this session (this
 * sandbox's egress policy blocks both api.ioda.caida.org and api.ooni.io
 * directly), so the exact base URL path prefix (assumed `/v2/` for IODA,
 * matching prior research) should still be confirmed on first live run.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/** IODA alert levels treated as noteworthy. 'normal' means no outage — filtered out entirely. */
const IODA_NOTEWORTHY_LEVELS = new Set(['warning', 'critical', 'severe', 'major']);

/** Minimum OONI sample size before an anomaly rate is trusted at all — a 2-measurement country is noise, not a signal. */
const OONI_MIN_MEASUREMENTS = 5;
/** Minimum anomaly rate (anomaly_count / measurement_count) to surface as an interference signal. */
const OONI_MIN_ANOMALY_RATE = 0.1;

/**
 * Map one IODA outage alert to a normalized record, or null if it should be
 * filtered out (level is 'normal', the entity isn't a country, or the
 * country code has no bundled centroid).
 * @param {object} alert - One element of the IODA `/outages/alerts/country` response array.
 * @param {Record<string, {name:string, lat:number, lon:number}>} countryCentroids
 * @returns {{id:string, source:'IODA', countryCode:string, countryName:string,
 *   lat:number, lon:number, kind:string, severity:string, dateMs:number}|null}
 */
export function mapIodaAlert(alert, countryCentroids) {
  const level = textOrNull(alert?.level)?.toLowerCase();
  if (!level || !IODA_NOTEWORTHY_LEVELS.has(level)) return null;
  const entity = alert?.entity;
  if (!entity || entity.type !== 'country') return null;
  const code = textOrNull(entity.code)?.toUpperCase();
  if (!code) return null;
  const centroid = countryCentroids?.[code];
  if (!centroid || !Number.isFinite(centroid.lat) || !Number.isFinite(centroid.lon)) return null;
  const timeSeconds = finiteOrNull(alert.time);
  if (timeSeconds === null) return null;
  const datasource = textOrNull(alert.datasource) || 'unknown';
  return {
    id: `ioda:${datasource}:${code}:${timeSeconds}`,
    source: 'IODA',
    countryCode: code,
    countryName: textOrNull(entity.name) || centroid.name,
    lat: centroid.lat,
    lon: centroid.lon,
    kind: datasource,
    severity: level === 'warning' ? 'Orange' : 'Red',
    dateMs: timeSeconds * 1000,
  };
}

/**
 * Map one OONI aggregation row (queried with `axis_x=probe_cc`) to a
 * normalized record, or null if it should be filtered out (too few
 * measurements to trust, anomaly rate below the noise floor, or the country
 * code has no bundled centroid).
 * @param {object} row - One element of the OONI `aggregation?axis_x=probe_cc` `result` array.
 * @param {Record<string, {name:string, lat:number, lon:number}>} countryCentroids
 * @param {number|null} [windowEndMs] - The query window's `until` date, as epoch ms — OONI aggregates carry no per-row timestamp of their own.
 * @returns {{id:string, source:'OONI', countryCode:string, countryName:string,
 *   lat:number, lon:number, kind:'censorship', severity:string, dateMs:number|null}|null}
 */
export function mapOoniAggregateRow(row, countryCentroids, windowEndMs = null) {
  const code = textOrNull(row?.probe_cc)?.toUpperCase();
  if (!code) return null;
  const measurementCount = finiteOrNull(row?.measurement_count);
  const anomalyCount = finiteOrNull(row?.anomaly_count);
  if (measurementCount === null || measurementCount < OONI_MIN_MEASUREMENTS) return null;
  if (anomalyCount === null || anomalyCount <= 0) return null;
  const anomalyRate = anomalyCount / measurementCount;
  if (anomalyRate < OONI_MIN_ANOMALY_RATE) return null;
  const centroid = countryCentroids?.[code];
  if (!centroid || !Number.isFinite(centroid.lat) || !Number.isFinite(centroid.lon)) return null;
  return {
    id: `ooni:${code}`,
    source: 'OONI',
    countryCode: code,
    countryName: centroid.name,
    lat: centroid.lat,
    lon: centroid.lon,
    kind: 'censorship',
    severity: anomalyRate >= 0.5 ? 'Red' : 'Orange',
    dateMs: finiteOrNull(windowEndMs),
  };
}
