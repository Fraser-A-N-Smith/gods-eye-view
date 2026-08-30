// GDACS/EONET filter and normalization rules — the single implementation
// shared by the /api/global-hazards proxy (vite.config.js) and the
// globalHazards.js layer. Testing it here, once, against its one real
// implementation is what makes server/client drift impossible rather than
// merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EONET_HAZARD_CATEGORIES,
  GDACS_HAZARD_TYPES,
  mapEonetFeature,
  mapGdacsFeature,
} from './globalHazardsShape.js';

test('GDACS_HAZARD_TYPES and EONET_HAZARD_CATEGORIES are the exact allow-lists from the spec', () => {
  assert.deepEqual([...GDACS_HAZARD_TYPES].sort(), ['DR', 'FL']);
  assert.deepEqual([...EONET_HAZARD_CATEGORIES].sort(), [
    'dustHaze', 'landslides', 'seaLakeIce', 'severeStorms', 'snow', 'tempExtremes', 'waterColor',
  ]);
});

test('mapGdacsFeature: keeps only FL/DR, current, non-Green events', () => {
  const base = {
    geometry: { coordinates: [56.78, 12.34] },
    properties: {
      eventtype: 'FL', eventid: '12345', name: 'Flood', alertlevel: 'Red',
      iscurrent: 'true', datemodified: '2026-08-20T00:00:00Z',
      url: { report: 'https://gdacs.org/report/12345' },
    },
  };
  const kept = mapGdacsFeature(base);
  assert.deepEqual(kept, {
    id: 'gdacs:FL:12345',
    source: 'GDACS',
    kind: 'FL',
    title: 'Flood',
    lat: 12.34,
    lon: 56.78,
    severity: 'Red',
    url: 'https://gdacs.org/report/12345',
    dateMs: Date.parse('2026-08-20T00:00:00Z'),
  });

  for (const eventtype of ['EQ', 'TC', 'WF', 'VO']) {
    assert.equal(mapGdacsFeature({
      ...base,
      properties: { ...base.properties, eventtype },
    }), null, `${eventtype} duplicates a dedicated layer and must be dropped`);
  }
  assert.equal(mapGdacsFeature({
    ...base,
    properties: { ...base.properties, alertlevel: 'Green' },
  }), null, 'Green alert level is routine noise and must be dropped');
  assert.equal(mapGdacsFeature({
    ...base,
    properties: { ...base.properties, iscurrent: 'false' },
  }), null, 'non-current episodes must be dropped');
  assert.equal(mapGdacsFeature({
    ...base,
    geometry: { coordinates: ['not-a-number', 12.34] },
  }), null, 'non-finite coordinates must be dropped');
  assert.equal(mapGdacsFeature(null), null);
  assert.equal(mapGdacsFeature({}), null);
});

test('mapGdacsFeature: falls back title/severity/url and derives dateMs from fromdate when datemodified is absent', () => {
  const r = mapGdacsFeature({
    geometry: { coordinates: [1, 2] },
    properties: {
      eventtype: 'DR', eventid: '9', description: 'Drought description', alertlevel: null,
      iscurrent: 'true', fromdate: '2026-01-01T00:00:00Z',
    },
  });
  assert.equal(r.title, 'Drought description');
  assert.equal(r.severity, 'Orange');
  assert.equal(r.url, null);
  assert.equal(r.dateMs, Date.parse('2026-01-01T00:00:00Z'));
});

test('mapEonetFeature: keeps only allow-listed categories and the LAST geometry point', () => {
  const base = {
    id: 'EONET_1234',
    title: 'Severe Storm Test',
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1234',
    categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    geometry: [
      { date: '2026-08-18T00:00:00Z', type: 'Point', coordinates: [10, 20] },
      { date: '2026-08-20T00:00:00Z', type: 'Point', coordinates: [11, 21] },
    ],
  };
  const kept = mapEonetFeature(base);
  assert.deepEqual(kept, {
    id: 'eonet:EONET_1234',
    source: 'EONET',
    kind: 'severeStorms',
    title: 'Severe Storm Test',
    lat: 21,
    lon: 11,
    severity: 'Orange',
    url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1234',
    dateMs: Date.parse('2026-08-20T00:00:00Z'),
  });

  for (const categoryId of ['wildfires', 'volcanoes', 'earthquakes', 'floods']) {
    assert.equal(mapEonetFeature({
      ...base,
      categories: [{ id: categoryId, title: categoryId }],
    }), null, `${categoryId} duplicates a dedicated layer and must be dropped`);
  }
  assert.equal(mapEonetFeature({ ...base, categories: [] }), null, 'no category must be dropped');
  assert.equal(mapEonetFeature({ ...base, geometry: [] }), null, 'no geometry must be dropped');
  assert.equal(mapEonetFeature(null), null);
});

test('mapEonetFeature: every EONET hazard reports Orange severity (EONET carries no GDACS-style alert level)', () => {
  const r = mapEonetFeature({
    id: 'EONET_5',
    title: 'Landslide',
    categories: [{ id: 'landslides' }],
    geometry: [{ date: '2026-05-01T00:00:00Z', coordinates: [0, 0] }],
  });
  assert.equal(r.severity, 'Orange');
});
