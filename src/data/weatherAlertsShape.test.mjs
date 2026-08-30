// NWS alerts and NHC cyclones. The central test is the zone-geometry one: a
// large share of NWS alerts have no polygon, and silently dropping them makes
// the map read as an all-clear over places that are under a warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  severityStyle,
  alertRings,
  normalizeAlert,
  normalizeAlertCollection,
  cycloneCategory,
  normalizeCyclone,
  normalizeCyclones,
  ALERT_SEVERITIES,
} from './weatherAlertsShape.js';

const ring = (x = 0, y = 0) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]];
const alertFeature = (properties, geometry = { type: 'Polygon', coordinates: [ring()] }) => ({
  type: 'Feature', properties, geometry,
});

test('severity styles are ordered most-severe-first and visually distinct', () => {
  const ranks = ALERT_SEVERITIES.map((s) => severityStyle(s).rank);
  assert.deepEqual(ranks, [0, 1, 2, 3, 4]);
  assert.equal(new Set(ALERT_SEVERITIES.map((s) => severityStyle(s).css)).size, ALERT_SEVERITIES.length);
});

test('an unrecognised severity is UNKNOWN, not the mildest band', () => {
  // Defaulting an unparseable severity to "Minor" would understate a warning.
  assert.equal(severityStyle('Catastrophic').label, 'UNKNOWN');
  assert.equal(severityStyle(null).label, 'UNKNOWN');
  assert.equal(severityStyle(undefined).label, 'UNKNOWN');
});

test('ZONE-ONLY ALERTS ARE KEPT: a null geometry does not delete the warning', () => {
  // Many NWS alerts are issued against forecast zones with no polygon. They
  // are real, often the serious ones, and must not vanish.
  const record = normalizeAlert(alertFeature({ event: 'Tornado Warning', severity: 'Extreme' }, null));
  assert.ok(record, 'the alert survives');
  assert.equal(record.drawable, false, 'but it is flagged as undrawable');
  assert.equal(record.event, 'Tornado Warning');
  assert.equal(record.severity, 'Extreme');
});

test('the collection counts drawn and zone-only separately', () => {
  const collection = {
    features: [
      alertFeature({ event: 'Flood Warning', severity: 'Severe' }),
      alertFeature({ event: 'Winter Storm Warning', severity: 'Moderate' }, null),
      alertFeature({ event: 'Heat Advisory', severity: 'Minor' }, null),
    ],
  };
  const result = normalizeAlertCollection(collection);
  assert.equal(result.alerts.length, 3, 'nothing is discarded');
  assert.equal(result.drawable, 1);
  assert.equal(result.zoneOnly, 2, 'the map shows fewer shapes than there are warnings, and says so');
});

test('alerts sort by severity so a cap drops the least serious', () => {
  const collection = {
    features: [
      alertFeature({ event: 'c', severity: 'Minor' }),
      alertFeature({ event: 'a', severity: 'Extreme' }),
      alertFeature({ event: 'b', severity: 'Moderate' }),
    ],
  };
  const { alerts } = normalizeAlertCollection(collection);
  assert.deepEqual(alerts.map((a) => a.event), ['a', 'b', 'c']);
  const capped = normalizeAlertCollection(collection, { maxAlerts: 1 });
  assert.equal(capped.alerts[0].severity, 'Extreme');
  assert.equal(capped.truncated, true);
  assert.equal(capped.total, 3, 'the real total survives the cap');
});

test('rings come from Polygon and MultiPolygon alike, and never from null', () => {
  assert.equal(alertRings({ type: 'Polygon', coordinates: [ring()] }).length, 1);
  assert.equal(alertRings({ type: 'MultiPolygon', coordinates: [[ring()], [ring(5, 5)]] }).length, 2);
  assert.deepEqual(alertRings(null), []);
  assert.deepEqual(alertRings({ type: 'Point', coordinates: [0, 0] }), []);
});

test('an alert with no properties at all is not a record', () => {
  assert.equal(normalizeAlert({}), null);
  assert.equal(normalizeAlert(null), null);
});

test('an alert missing its event name still renders under a generic label', () => {
  const record = normalizeAlert(alertFeature({ severity: 'Severe' }));
  assert.equal(record.event, 'WEATHER ALERT');
});

test('a malformed alert payload yields an empty, honest result', () => {
  for (const input of [null, {}, { features: null }, { features: [] }]) {
    const result = normalizeAlertCollection(input);
    assert.deepEqual(result.alerts, []);
    assert.equal(result.drawable, 0);
    assert.equal(result.zoneOnly, 0);
  }
});

test('Saffir-Simpson bands map wind to category at the documented thresholds', () => {
  assert.equal(cycloneCategory(30).category, 'TROPICAL DEPRESSION');
  assert.equal(cycloneCategory(34).category, 'TROPICAL STORM');
  assert.equal(cycloneCategory(63).category, 'TROPICAL STORM');
  assert.equal(cycloneCategory(64).category, 'CAT 1');
  assert.equal(cycloneCategory(83).category, 'CAT 2');
  assert.equal(cycloneCategory(96).category, 'CAT 3');
  assert.equal(cycloneCategory(113).category, 'CAT 4');
  assert.equal(cycloneCategory(137).category, 'CAT 5');
});

test('an unknown wind is UNKNOWN, never a depression', () => {
  // Absent intensity rendered as the weakest band would understate a storm.
  for (const input of [null, undefined, '', NaN]) {
    const band = cycloneCategory(input);
    assert.equal(band.category, 'UNKNOWN');
    assert.equal(band.rank, -1);
  }
});

test('a cyclone normalizes across the field-name variants NHC products use', () => {
  const a = normalizeCyclone({ id: 'al052026', name: 'FIONA', latitudeNumeric: 24.5, longitudeNumeric: -71.2, intensity: 105, pressure: 948 });
  assert.equal(a.name, 'FIONA');
  assert.equal(a.windKt, 105);
  assert.equal(a.pressureMb, 948);

  const b = normalizeCyclone({ name: 'GASTON', lat: 30, lon: -50, maxWindKt: 45 });
  assert.equal(b.windKt, 45);
  assert.equal(b.lat, 30);
});

test('a cyclone with no position is dropped', () => {
  assert.equal(normalizeCyclone({ name: 'X' }), null);
  assert.equal(normalizeCyclone({ name: 'X', lat: 999, lon: 0 }), null);
  assert.equal(normalizeCyclone(null), null);
});

test('an unnamed system is labelled, not blank', () => {
  assert.equal(normalizeCyclone({ lat: 10, lon: 10, intensity: 40 }).name, 'UNNAMED SYSTEM');
});

test('storms sort strongest-first and accept either payload shape', () => {
  const storms = [
    { name: 'weak', lat: 1, lon: 1, intensity: 40 },
    { name: 'major', lat: 2, lon: 2, intensity: 120 },
  ];
  assert.deepEqual(normalizeCyclones(storms).storms.map((s) => s.name), ['major', 'weak']);
  assert.deepEqual(normalizeCyclones({ activeStorms: storms }).storms.map((s) => s.name), ['major', 'weak']);
  assert.deepEqual(normalizeCyclones(null).storms, []);
});

test('a zero-knot reading is zero, not unknown', () => {
  assert.equal(normalizeCyclone({ lat: 1, lon: 1, intensity: 0 }).windKt, 0);
});
