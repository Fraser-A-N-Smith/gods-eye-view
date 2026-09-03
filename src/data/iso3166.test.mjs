import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alpha2ToAlpha3 } from './iso3166.js';

test('converts known alpha-2 codes, case-insensitively', () => {
  assert.equal(alpha2ToAlpha3('US'), 'USA');
  assert.equal(alpha2ToAlpha3('us'), 'USA');
  assert.equal(alpha2ToAlpha3('Fr'), 'FRA');
  assert.equal(alpha2ToAlpha3('JP'), 'JPN');
  assert.equal(alpha2ToAlpha3('GB'), 'GBR');
  assert.equal(alpha2ToAlpha3('PS'), 'PSE', 'Palestinian territories are a real ISO entry');
});

test('returns null for malformed or unknown input rather than guessing', () => {
  assert.equal(alpha2ToAlpha3(''), null);
  assert.equal(alpha2ToAlpha3(null), null);
  assert.equal(alpha2ToAlpha3(undefined), null);
  assert.equal(alpha2ToAlpha3('USA'), null, 'three letters is not a valid alpha-2 input');
  assert.equal(alpha2ToAlpha3('ZZ'), null, 'ZZ is not an assigned ISO code');
  assert.equal(alpha2ToAlpha3(123), null);
});
