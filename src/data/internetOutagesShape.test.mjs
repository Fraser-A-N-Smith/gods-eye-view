// IODA/OONI filter and normalization rules — the single implementation
// shared by the /api/internet-outages proxy (vite.config.js) and the
// internetOutages.js layer. Testing it here, once, against its one real
// implementation is what makes server/client drift impossible rather than
// merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapIodaAlert, mapOoniAggregateRow } from './internetOutagesShape.js';

test('config/country_centroids.json parses and every entry is a valid ISO code with a finite in-range coordinate', () => {
  const path = new URL('../../config/country_centroids.json', import.meta.url);
  const table = JSON.parse(readFileSync(path, 'utf8'));
  const codes = Object.keys(table);
  assert.ok(codes.length > 100, 'expected broad country coverage, not a token handful');
  for (const code of codes) {
    assert.match(code, /^[A-Z]{2}$/, `key ${code} must be an uppercase ISO alpha-2 code`);
    const entry = table[code];
    assert.equal(typeof entry.name, 'string');
    assert.ok(entry.name.trim(), `${code} must have a non-empty name`);
    assert.ok(Number.isFinite(entry.lat) && entry.lat >= -90 && entry.lat <= 90, `${code} lat out of range`);
    assert.ok(Number.isFinite(entry.lon) && entry.lon >= -180 && entry.lon <= 180, `${code} lon out of range`);
  }
});

const CENTROIDS = {
  US: { name: 'United States', lat: 38.8208, lon: -96.3316 },
  MV: { name: 'Maldives', lat: 3.5, lon: 73.1 },
};

test('mapIodaAlert: a warning-level country alert maps to an Orange record', () => {
  const alert = {
    datasource: 'ping-slash24',
    entity: { code: 'MV', name: 'Maldives', type: 'country', attrs: {} },
    time: 1572825600,
    level: 'warning',
    condition: '> 10 AND < historical * 0.8',
    value: 107,
    historyValue: 151,
  };
  assert.deepEqual(mapIodaAlert(alert, CENTROIDS), {
    id: 'ioda:ping-slash24:MV:1572825600',
    source: 'IODA',
    countryCode: 'MV',
    countryName: 'Maldives',
    lat: 3.5,
    lon: 73.1,
    kind: 'ping-slash24',
    severity: 'Orange',
    dateMs: 1572825600000,
  });
});

test('mapIodaAlert: a non-warning noteworthy level (e.g. critical) maps to Red', () => {
  const r = mapIodaAlert({
    datasource: 'bgp',
    entity: { code: 'US', name: 'United States', type: 'country' },
    time: 1000,
    level: 'critical',
  }, CENTROIDS);
  assert.equal(r.severity, 'Red');
});

test('mapIodaAlert: a "normal" level alert is dropped — that is IODA saying nothing is wrong', () => {
  assert.equal(mapIodaAlert({
    datasource: 'bgp',
    entity: { code: 'US', type: 'country' },
    time: 1000,
    level: 'normal',
  }, CENTROIDS), null);
});

test('mapIodaAlert: non-country entities, missing level/time, and unmapped country codes are dropped', () => {
  const base = { datasource: 'bgp', entity: { code: 'US', type: 'country' }, time: 1000, level: 'warning' };
  assert.equal(mapIodaAlert({ ...base, entity: { code: 'AS1234', type: 'asn' } }, CENTROIDS), null, 'non-country entity');
  assert.equal(mapIodaAlert({ ...base, level: null }, CENTROIDS), null, 'missing level');
  assert.equal(mapIodaAlert({ ...base, time: 'not-a-number' }, CENTROIDS), null, 'missing/invalid time');
  assert.equal(mapIodaAlert({ ...base, entity: { code: 'ZZ', type: 'country' } }, CENTROIDS), null, 'country with no bundled centroid');
  assert.equal(mapIodaAlert(null, CENTROIDS), null);
  assert.equal(mapIodaAlert({}, CENTROIDS), null);
});

test('mapIodaAlert: falls back to the centroid table\'s name when the entity carries none', () => {
  const r = mapIodaAlert({
    datasource: 'bgp', entity: { code: 'us', type: 'country' }, time: 1000, level: 'warning',
  }, CENTROIDS);
  assert.equal(r.countryCode, 'US', 'country codes are upper-cased');
  assert.equal(r.countryName, 'United States');
});

const OONI_ROW_MV = { probe_cc: 'MV', anomaly_count: 3, confirmed_count: 1, failure_count: 0, measurement_count: 10 };

test('mapOoniAggregateRow: a row above the sample-size and anomaly-rate floor maps to a record', () => {
  assert.deepEqual(mapOoniAggregateRow(OONI_ROW_MV, CENTROIDS, 1700000000000), {
    id: 'ooni:MV',
    source: 'OONI',
    countryCode: 'MV',
    countryName: 'Maldives',
    lat: 3.5,
    lon: 73.1,
    kind: 'censorship',
    severity: 'Orange',
    dateMs: 1700000000000,
  });
});

test('mapOoniAggregateRow: a >=50% anomaly rate reads Red, below that reads Orange', () => {
  const high = mapOoniAggregateRow({ probe_cc: 'US', anomaly_count: 6, measurement_count: 10 }, CENTROIDS);
  assert.equal(high.severity, 'Red');
  const low = mapOoniAggregateRow({ probe_cc: 'US', anomaly_count: 2, measurement_count: 10 }, CENTROIDS);
  assert.equal(low.severity, 'Orange');
});

test('mapOoniAggregateRow: too few measurements, zero anomalies, or a below-floor rate are all dropped as noise', () => {
  assert.equal(mapOoniAggregateRow({ probe_cc: 'US', anomaly_count: 2, measurement_count: 3 }, CENTROIDS), null, 'sample too small to trust');
  assert.equal(mapOoniAggregateRow({ probe_cc: 'US', anomaly_count: 0, measurement_count: 100 }, CENTROIDS), null, 'zero anomalies');
  assert.equal(mapOoniAggregateRow({ probe_cc: 'US', anomaly_count: 1, measurement_count: 100 }, CENTROIDS), null, 'below the 10% noise floor');
});

test('mapOoniAggregateRow: missing probe_cc or an unmapped country code is dropped', () => {
  assert.equal(mapOoniAggregateRow({ anomaly_count: 5, measurement_count: 10 }, CENTROIDS), null);
  assert.equal(mapOoniAggregateRow({ probe_cc: 'ZZ', anomaly_count: 5, measurement_count: 10 }, CENTROIDS), null);
  assert.equal(mapOoniAggregateRow(null, CENTROIDS), null);
});

test('mapOoniAggregateRow: dateMs carries the query window end, or null when not supplied', () => {
  assert.equal(mapOoniAggregateRow(OONI_ROW_MV, CENTROIDS).dateMs, null);
  assert.equal(mapOoniAggregateRow(OONI_ROW_MV, CENTROIDS, 'not-a-number').dateMs, null);
});
