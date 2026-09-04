// GFW GLAD-L alert normalizer — the single implementation shared by the
// /api/deforestation-alerts proxy (vite.config.js) and the
// deforestationAlerts.js layer. Testing it here, once, against its one real
// implementation is what makes server/client drift impossible rather than
// merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapGfwAlert, mapGfwAlertFeed } from './deforestationAlertsShape.js';

test('mapGfwAlert: maps a well-formed row using the primary column spelling', () => {
  const r = mapGfwAlert({
    latitude: -3.1, longitude: -60.2,
    umd_glad_landsat_alerts__date: '2026-08-20', umd_glad_landsat_alerts__confidence: 'high',
  });
  assert.deepEqual(r, {
    id: 'gfw:-3.10000,-60.20000:2026-08-20T00:00:00.000Z',
    lat: -3.1, lon: -60.2, alertDate: '2026-08-20T00:00:00.000Z', confidence: 'high',
  });
});

test('mapGfwAlert: accepts alternate column spellings', () => {
  const r = mapGfwAlert({ lat: 1.5, lon: 101.2, alert_date: '2026-08-01', confidence: 'nominal' });
  assert.equal(r.lat, 1.5);
  assert.equal(r.alertDate, '2026-08-01T00:00:00.000Z');
  assert.equal(r.confidence, 'nominal');
});

test('mapGfwAlert: rejects a missing or non-finite position', () => {
  assert.equal(mapGfwAlert({ longitude: -60.2 }), null);
  assert.equal(mapGfwAlert({ latitude: -3.1 }), null);
  assert.equal(mapGfwAlert({ latitude: 'not-a-number', longitude: -60.2 }), null);
  assert.equal(mapGfwAlert(null), null);
});

test('mapGfwAlert: a missing/unparseable date or confidence becomes null, not a crash', () => {
  const r = mapGfwAlert({ latitude: 1, longitude: 2 });
  assert.equal(r.alertDate, null);
  assert.equal(r.confidence, null);
  assert.equal(mapGfwAlert({ latitude: 1, longitude: 2, alert_date: 'not-a-date' }).alertDate, null);
});

test('mapGfwAlert: output is JSON-safe', () => {
  const r = mapGfwAlert({ latitude: 1, longitude: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test('mapGfwAlertFeed: maps a {data:[...]} wrapper and a bare array', () => {
  const row = { latitude: 1, longitude: 2 };
  assert.equal(mapGfwAlertFeed({ data: [row] }).length, 1);
  assert.equal(mapGfwAlertFeed([row]).length, 1);
});

test('mapGfwAlertFeed: drops unusable rows and caps at maxCount', () => {
  const rows = [
    { latitude: 1, longitude: 2 },
    { longitude: 2 }, // no latitude — dropped
    { latitude: 3, longitude: 4 },
  ];
  assert.equal(mapGfwAlertFeed(rows).length, 2);
  assert.equal(mapGfwAlertFeed(rows, 1).length, 1);
});

test('mapGfwAlertFeed: non-array/malformed payloads yield an empty array', () => {
  assert.deepEqual(mapGfwAlertFeed(null), []);
  assert.deepEqual(mapGfwAlertFeed(undefined), []);
  assert.deepEqual(mapGfwAlertFeed({}), []);
  assert.deepEqual(mapGfwAlertFeed('not an object'), []);
});
