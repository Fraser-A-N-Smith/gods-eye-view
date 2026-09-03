import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCountryCentroid } from './countryCentroids.js';

test('findCountryCentroid: matches a canonical name', () => {
  assert.deepEqual(findCountryCentroid('Kenya'), [-1.29, 36.82]);
  assert.deepEqual(findCountryCentroid('kenya'), [-1.29, 36.82], 'case-insensitive');
});

test('findCountryCentroid: matches common aliases', () => {
  assert.deepEqual(findCountryCentroid('DRC'), findCountryCentroid('Democratic Republic of the Congo'));
  assert.deepEqual(findCountryCentroid('USA'), findCountryCentroid('United States of America'));
  assert.deepEqual(findCountryCentroid('Ivory Coast'), findCountryCentroid("Cote d'Ivoire"));
  assert.deepEqual(findCountryCentroid('Burma'), findCountryCentroid('Myanmar'));
});

test('findCountryCentroid: tolerates diacritics', () => {
  assert.deepEqual(findCountryCentroid("Côte d'Ivoire"), findCountryCentroid("Cote d'Ivoire"));
});

test('findCountryCentroid: an unknown name returns null, not a guess', () => {
  assert.equal(findCountryCentroid('Wakanda'), null);
  assert.equal(findCountryCentroid(''), null);
  assert.equal(findCountryCentroid(null), null);
  assert.equal(findCountryCentroid(undefined), null);
});

test('findCountryCentroid: every entry is a valid [lat, lon] pair', () => {
  for (const name of ['Kenya', 'Brazil', 'Japan', 'Nigeria', 'France', 'India']) {
    const r = findCountryCentroid(name);
    assert.ok(Array.isArray(r) && r.length === 2, `${name} must resolve`);
    const [lat, lon] = r;
    assert.ok(lat >= -90 && lat <= 90, `${name} lat in range`);
    assert.ok(lon >= -180 && lon <= 180, `${name} lon in range`);
  }
});
