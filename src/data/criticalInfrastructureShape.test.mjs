// Overpass element-mapping rule — the single implementation shared by the
// /api/critical-infrastructure proxy (vite.config.js) and the
// criticalInfrastructure.js layer. Testing it here, once, against its one
// real implementation is what makes server/client drift impossible rather
// than merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOverpassElement } from './criticalInfrastructureShape.js';

test('mapOverpassElement: node with power=plant tag maps to a power-plant record', () => {
  const el = { type: 'node', id: 1, lat: 51.5, lon: -0.1, tags: { power: 'plant', name: 'Battersea' } };
  assert.deepEqual(mapOverpassElement(el), { id: 'node/1', kind: 'power-plant', name: 'Battersea', lat: 51.5, lon: -0.1 });
});

test('mapOverpassElement: way with amenity=hospital uses the center point', () => {
  const el = { type: 'way', id: 2, center: { lat: 40.7, lon: -74.0 }, tags: { amenity: 'hospital', name: 'City General' } };
  assert.deepEqual(mapOverpassElement(el), { id: 'way/2', kind: 'hospital', name: 'City General', lat: 40.7, lon: -74.0 });
});

test('mapOverpassElement: relation with a center point maps like a way', () => {
  const el = { type: 'relation', id: 9, center: { lat: 10, lon: 20 }, tags: { power: 'plant', name: 'Grid Node' } };
  assert.deepEqual(mapOverpassElement(el), { id: 'relation/9', kind: 'power-plant', name: 'Grid Node', lat: 10, lon: 20 });
});

test('mapOverpassElement: missing name falls back to a generic label per kind', () => {
  assert.equal(mapOverpassElement({ type: 'node', id: 3, lat: 0, lon: 0, tags: { power: 'plant' } }).name, 'Unnamed power plant');
  assert.equal(mapOverpassElement({ type: 'node', id: 4, lat: 0, lon: 0, tags: { amenity: 'hospital' } }).name, 'Unnamed hospital');
});

test('mapOverpassElement: whitespace-only name is treated as missing', () => {
  const el = { type: 'node', id: 10, lat: 0, lon: 0, tags: { power: 'plant', name: '   ' } };
  assert.equal(mapOverpassElement(el).name, 'Unnamed power plant');
});

test('mapOverpassElement: element with neither direct nor center coordinates returns null', () => {
  assert.equal(mapOverpassElement({ type: 'way', id: 5, tags: { power: 'plant' } }), null);
});

test('mapOverpassElement: a direct lat with no lon (and vice versa) is not usable', () => {
  assert.equal(mapOverpassElement({ type: 'node', id: 11, lat: 1, tags: { power: 'plant' } }), null);
  assert.equal(mapOverpassElement({ type: 'node', id: 12, lon: 1, tags: { power: 'plant' } }), null);
});

test('mapOverpassElement: non-finite coordinates are dropped, not coerced', () => {
  assert.equal(mapOverpassElement({ type: 'node', id: 13, lat: 'oops', lon: 0, tags: { power: 'plant' } }), null);
  assert.equal(mapOverpassElement({ type: 'way', id: 14, center: { lat: NaN, lon: 0 }, tags: { power: 'plant' } }), null);
});

test('mapOverpassElement: element with neither tag matches returns null', () => {
  assert.equal(mapOverpassElement({ type: 'node', id: 6, lat: 0, lon: 0, tags: { shop: 'bakery' } }), null);
});

test('mapOverpassElement: an element missing type or id returns null rather than an "undefined/undefined" id', () => {
  // With entity-id deduplication in play (entityDedupe.js), two elements
  // both missing type/id would otherwise collide on the literal string
  // "undefined/undefined" instead of being dropped individually.
  assert.equal(mapOverpassElement({ id: 1, lat: 0, lon: 0, tags: { power: 'plant' } }), null, 'missing type');
  assert.equal(mapOverpassElement({ type: 'node', lat: 0, lon: 0, tags: { power: 'plant' } }), null, 'missing id');
  assert.equal(mapOverpassElement({ type: 'node', id: 0, lat: 0, lon: 0, tags: { power: 'plant' } })?.id, 'node/0', 'id 0 is a real id, not "missing"');
});

test('mapOverpassElement: absent tags object is handled without throwing', () => {
  assert.equal(mapOverpassElement({ type: 'node', id: 7, lat: 0, lon: 0 }), null);
  assert.equal(mapOverpassElement(null), null);
  assert.equal(mapOverpassElement(undefined), null);
});

test('mapOverpassElement: output is JSON-safe', () => {
  const r = mapOverpassElement({ type: 'node', id: 1, lat: 51.5, lon: -0.1, tags: { power: 'plant', name: 'Battersea' } });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});
