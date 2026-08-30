// Wildfire perimeter normalization. The upstream is an ArcGIS service whose
// attribute names carry source-dependent prefixes and have drifted across
// revisions, so the mapping is alias-tolerant on purpose — and the tests hold
// it to degrading into "unknown" rather than guessing when nothing matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickField,
  simplifyRing,
  outerRings,
  normalizePerimeter,
  normalizePerimeterCollection,
  FIELD_ALIASES,
} from './firePerimetersShape.js';

/** A square ring, closed, with `extra` collinear points along the top edge. */
function squareRing(x = 0, y = 0, size = 1, extra = 0) {
  const ring = [[x, y]];
  for (let i = 1; i <= extra; i += 1) ring.push([x + (size * i) / (extra + 1), y]);
  ring.push([x + size, y], [x + size, y + size], [x, y + size], [x, y]);
  return ring;
}

const polygon = (ring, rest = []) => ({ type: 'Polygon', coordinates: [ring, ...rest] });

test('pickField takes the first present alias, in priority order', () => {
  assert.equal(pickField({ poly_IncidentName: 'PALISADES', IncidentName: 'OTHER' }, FIELD_ALIASES.name), 'PALISADES');
  assert.equal(pickField({ IncidentName: 'FALLBACK' }, FIELD_ALIASES.name), 'FALLBACK');
});

test('empty strings and nulls are not treated as present values', () => {
  assert.equal(pickField({ poly_IncidentName: '', IncidentName: 'REAL' }, FIELD_ALIASES.name), 'REAL');
  assert.equal(pickField({ poly_IncidentName: null, IncidentName: 'REAL' }, FIELD_ALIASES.name), 'REAL');
  assert.equal(pickField({}, FIELD_ALIASES.name), null);
  assert.equal(pickField(null, FIELD_ALIASES.name), null);
});

test('DEGRADES HONESTLY: unknown attribute names become nulls, not guesses', () => {
  const record = normalizePerimeter({
    properties: { some_future_field: 'MYSTERY', another: 42 },
    geometry: polygon(squareRing()),
  });
  assert.equal(record.name, 'UNNAMED INCIDENT');
  assert.equal(record.acres, null, 'an unreadable size is unknown, never zero');
  assert.equal(record.containedPct, null);
  assert.ok(record.rings.length, 'geometry still renders — the shape is the point');
});

test('a record carries the fields the card needs', () => {
  const record = normalizePerimeter({
    properties: {
      poly_IncidentName: 'PARK FIRE',
      poly_GISAcres: 429603,
      attr_PercentContained: 42,
      attr_FireDiscoveryDateTime: '2026-07-24T18:21:00Z',
      attr_UniqueFireIdentifier: '2026-CACNF-001234',
      attr_POOState: 'US-CA',
    },
    geometry: polygon(squareRing()),
  });
  assert.equal(record.name, 'PARK FIRE');
  assert.equal(record.acres, 429603);
  assert.equal(record.containedPct, 42);
  assert.equal(record.id, '2026-CACNF-001234');
  assert.equal(record.state, 'US-CA');
});

test('simplifyRing drops collinear filler', () => {
  const dense = squareRing(0, 0, 1, 40);
  const simplified = simplifyRing(dense, 0.001);
  assert.ok(simplified.length < dense.length, 'collinear points along an edge are removable');
  assert.ok(simplified.length >= 4);
});

test('simplification never destroys the polygon', () => {
  // A tolerance far larger than the shape would collapse it to a line.
  const ring = squareRing(0, 0, 0.001);
  const simplified = simplifyRing(ring, 10);
  assert.ok(simplified.length >= 4, 'a polygon that cannot survive simplification is left alone');
});

test('simplified rings stay closed', () => {
  const simplified = simplifyRing(squareRing(0, 0, 1, 30), 0.01);
  assert.deepEqual(simplified[0], simplified[simplified.length - 1]);
});

test('a ring too short to simplify is returned untouched', () => {
  const triangle = [[0, 0], [1, 0], [0, 1], [0, 0]];
  assert.equal(simplifyRing(triangle, 0.1), triangle);
  assert.equal(simplifyRing(null, 0.1), null);
});

test('MultiPolygon contributes every part', () => {
  const { rings } = outerRings({
    type: 'MultiPolygon',
    coordinates: [[squareRing(0, 0)], [squareRing(5, 5)]],
  }, 0.001);
  assert.equal(rings.length, 2);
});

test('holes are dropped but the drop is DISCLOSED, not silent', () => {
  // An unburned island rendered as another filled polygon would read as a
  // second fire — so it is dropped, and the record says the outline is outer-only.
  const { rings, hasHoles } = outerRings(polygon(squareRing(0, 0, 10), [squareRing(2, 2, 1)]), 0.001);
  assert.equal(rings.length, 1, 'only the outer ring is drawn');
  assert.equal(hasHoles, true, 'and the record admits there were holes');
});

test('a feature with no drawable geometry is dropped, not rendered empty', () => {
  assert.equal(normalizePerimeter({ properties: {}, geometry: null }), null);
  assert.equal(normalizePerimeter({ properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }), null);
  assert.equal(normalizePerimeter({}), null);
});

test('the collection is ordered largest-first so caps drop the least interesting fires', () => {
  const features = [
    { properties: { poly_IncidentName: 'SMALL', poly_GISAcres: 10 }, geometry: polygon(squareRing(0, 0)) },
    { properties: { poly_IncidentName: 'HUGE', poly_GISAcres: 400000 }, geometry: polygon(squareRing(2, 2)) },
    { properties: { poly_IncidentName: 'MID', poly_GISAcres: 5000 }, geometry: polygon(squareRing(4, 4)) },
  ];
  const { perimeters } = normalizePerimeterCollection({ type: 'FeatureCollection', features });
  assert.deepEqual(perimeters.map((p) => p.name), ['HUGE', 'MID', 'SMALL']);
});

test('the feature cap binds and is reported', () => {
  const features = Array.from({ length: 20 }, (_, i) => ({
    properties: { poly_IncidentName: `F${i}`, poly_GISAcres: i },
    geometry: polygon(squareRing(i, 0)),
  }));
  const result = normalizePerimeterCollection({ features }, { maxFeatures: 5 });
  assert.equal(result.perimeters.length, 5);
  assert.equal(result.truncated, true, 'a partial set must never present as complete');
  assert.equal(result.totalFeatures, 20, 'and the real upstream count is kept');
});

test('the VERTEX cap binds independently — a few huge perimeters can outweigh many small ones', () => {
  const big = {
    properties: { poly_IncidentName: 'MONSTER', poly_GISAcres: 999999 },
    // A dense ring that survives simplification because its points are not collinear.
    geometry: polygon([
      ...Array.from({ length: 400 }, (_, i) => {
        const angle = (i / 400) * Math.PI * 2;
        return [Math.cos(angle) * 5, Math.sin(angle) * 5];
      }),
      [5, 0],
    ]),
  };
  const result = normalizePerimeterCollection(
    { features: [big, big, big, big] },
    { maxVertices: 300, toleranceDeg: 0 },
  );
  assert.equal(result.truncated, true);
  assert.ok(result.perimeters.length < 4, 'geometry volume bounds the set, not just the count');
});

test('an untruncated set does not claim to be truncated', () => {
  const result = normalizePerimeterCollection({
    features: [{ properties: { poly_IncidentName: 'ONE' }, geometry: polygon(squareRing()) }],
  });
  assert.equal(result.truncated, false);
  assert.equal(result.perimeters.length, 1);
});

test('a malformed or empty upstream payload yields an empty set, not a throw', () => {
  for (const input of [null, {}, { features: null }, { features: [] }]) {
    const result = normalizePerimeterCollection(input);
    assert.deepEqual(result.perimeters, []);
    assert.equal(result.truncated, false);
  }
});
