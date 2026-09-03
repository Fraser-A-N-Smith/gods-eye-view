// GVP filter and normalization rules — the single implementation shared by
// the /api/volcanoes proxy (vite.config.js) and the volcanoes.js layer.
// Testing it here, once, against its one real implementation is what makes
// server/client drift impossible rather than merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_ERUPTION_YEAR, mapVolcanoFeature, mapVolcanoNotice, mergeVolcanoAlerts } from './volcanoesShape.js';

const BASE = {
  geometry: { coordinates: [-155.28, 19.42] },
  properties: {
    Volcano_Number: 332010,
    Volcano_Name: 'Kilauea',
    Primary_Volcano_Type: 'Shield',
    Last_Eruption_Year: 2024,
    Country: 'United States',
    Elevation: 1222,
  },
};

test('MIN_ERUPTION_YEAR is 1900', () => {
  assert.equal(MIN_ERUPTION_YEAR, 1900);
});

test('mapVolcanoFeature: maps every contract field for a qualifying feature', () => {
  const r = mapVolcanoFeature(BASE);
  assert.deepEqual(r, {
    id: 'gvp:332010',
    name: 'Kilauea',
    lat: 19.42,
    lon: -155.28,
    lastEruptionYear: 2024,
    country: 'United States',
    volcanoType: 'Shield',
    elevationM: 1222,
  });
});

test('mapVolcanoFeature: drops volcanoes with no eruption since 1900', () => {
  assert.equal(mapVolcanoFeature({
    ...BASE,
    properties: { ...BASE.properties, Last_Eruption_Year: 1899 },
  }), null);
  assert.equal(mapVolcanoFeature({
    ...BASE,
    properties: { ...BASE.properties, Last_Eruption_Year: -8300 },
  }), null, 'BCE eruption years must be dropped');
  assert.equal(mapVolcanoFeature({
    ...BASE,
    properties: { ...BASE.properties, Last_Eruption_Year: null },
  }), null, 'missing eruption year must be dropped, not coerced to 0');
});

test('mapVolcanoFeature: keeps the boundary year exactly', () => {
  const r = mapVolcanoFeature({
    ...BASE,
    properties: { ...BASE.properties, Last_Eruption_Year: 1900 },
  });
  assert.equal(r.lastEruptionYear, 1900);
});

test('mapVolcanoFeature: drops features with non-finite coordinates', () => {
  assert.equal(mapVolcanoFeature({
    ...BASE,
    geometry: { coordinates: ['not-a-number', 19.42] },
  }), null);
  assert.equal(mapVolcanoFeature({ ...BASE, geometry: {} }), null);
  assert.equal(mapVolcanoFeature({ ...BASE, geometry: null }), null);
});

test('mapVolcanoFeature: falls back name and derives id from coordinates when Volcano_Number is absent', () => {
  const r = mapVolcanoFeature({
    ...BASE,
    properties: { ...BASE.properties, Volcano_Number: null, Volcano_Name: '' },
  });
  assert.equal(r.name, 'Unnamed volcano');
  assert.equal(r.id, 'gvp:-155.2800,19.4200');
});

test('mapVolcanoFeature: missing optional fields become null, never NaN/undefined', () => {
  const r = mapVolcanoFeature({
    geometry: { coordinates: [10, 20] },
    properties: { Last_Eruption_Year: 1950 },
  });
  assert.equal(r.country, null);
  assert.equal(r.volcanoType, null);
  assert.equal(r.elevationM, null);
  for (const [key, value] of Object.entries(r)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('mapVolcanoFeature: null/empty input is rejected', () => {
  assert.equal(mapVolcanoFeature(null), null);
  assert.equal(mapVolcanoFeature(undefined), null);
  assert.equal(mapVolcanoFeature({}), null);
});

test('mapVolcanoFeature: output is JSON-safe', () => {
  const r = mapVolcanoFeature(BASE);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

// ── USGS Volcano Notification enrichment ────────────────────────────────────

test('mapVolcanoNotice: maps a well-formed notice with alert level and color code', () => {
  assert.deepEqual(
    mapVolcanoNotice({ volcano_name: 'Kilauea', alert_level: 'watch', color_code: 'orange', updated: '2026-08-30T00:00:00Z' }),
    { volcanoName: 'Kilauea', alertLevel: 'WATCH', colorCode: 'ORANGE', updatedAt: '2026-08-30T00:00:00.000Z' },
  );
});

test('mapVolcanoNotice: accepts alternate field name spellings', () => {
  const r = mapVolcanoNotice({ volcanoName: 'Mount St. Helens', alertLevel: 'ADVISORY' });
  assert.equal(r.volcanoName, 'Mount St. Helens');
  assert.equal(r.alertLevel, 'ADVISORY');
});

test('mapVolcanoNotice: rejects a value outside the real USGS vocabulary rather than guessing', () => {
  assert.equal(mapVolcanoNotice({ volcano_name: 'Test', alert_level: 'SEVERE' }), null);
  assert.equal(mapVolcanoNotice({ volcano_name: 'Test', color_code: 'PURPLE' }), null);
});

test('mapVolcanoNotice: rejects a missing name or a notice with neither alert level nor color code', () => {
  assert.equal(mapVolcanoNotice({ alert_level: 'WATCH' }), null);
  assert.equal(mapVolcanoNotice({ volcano_name: 'Test' }), null);
  assert.equal(mapVolcanoNotice(null), null);
});

test('mergeVolcanoAlerts: attaches a matching notice by name, diacritic- and case-insensitively', () => {
  const volcanoes = [{ id: 'gvp:1', name: 'Kīlauea' }, { id: 'gvp:2', name: 'Mount St. Helens' }];
  const notices = [{ volcanoName: 'kilauea', alertLevel: 'WATCH', colorCode: 'ORANGE', updatedAt: '2026-08-30T00:00:00.000Z' }];
  const merged = mergeVolcanoAlerts(volcanoes, notices);
  assert.equal(merged[0].alertLevel, 'WATCH');
  assert.equal(merged[0].colorCode, 'ORANGE');
  assert.equal(merged[0].alertUpdatedAt, '2026-08-30T00:00:00.000Z');
  assert.equal(merged[1].alertLevel, null, 'a volcano with no matching notice is untouched, not an error');
  assert.equal(merged[1].colorCode, null);
});

test('mergeVolcanoAlerts: never drops or reorders volcanoes, and tolerates missing/malformed input', () => {
  const volcanoes = [{ id: 'gvp:1', name: 'A' }, { id: 'gvp:2', name: 'B' }];
  assert.equal(mergeVolcanoAlerts(volcanoes, []).length, 2);
  assert.equal(mergeVolcanoAlerts(volcanoes, null).length, 2);
  assert.deepEqual(mergeVolcanoAlerts(volcanoes, undefined).map((v) => v.id), ['gvp:1', 'gvp:2']);
  assert.deepEqual(mergeVolcanoAlerts(null, []), []);
});
