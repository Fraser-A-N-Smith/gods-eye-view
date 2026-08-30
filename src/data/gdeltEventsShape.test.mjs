// GDELT event layer shape. The load-bearing test here is the first one: the
// query surface is a closed allowlist, because GDELT's GEO API will geocode a
// person's name and this project does not build named-person search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GDELT_PRESETS,
  GDELT_PRESET_IDS,
  DEFAULT_GDELT_PRESET_ID,
  resolvePreset,
  stripHtml,
  normalizeGdeltFeature,
  normalizeGdeltCollection,
  mentionPixelSize,
} from './gdeltEventsShape.js';

const point = (lon, lat, properties = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

test('CLOSED ALLOWLIST: only known preset ids resolve, and nothing substitutes', () => {
  // An unknown id must be a refusal, not a silent fallback — substituting a
  // different query would make the layer's own label a lie.
  assert.equal(resolvePreset('nope'), null);
  assert.equal(resolvePreset(''), null);
  assert.equal(resolvePreset(null), null);
  assert.equal(resolvePreset(undefined), null);
  assert.equal(resolvePreset(123), null);
  // The shapes a caller might use to smuggle free text through are just ids
  // that do not exist.
  assert.equal(resolvePreset('theme:PROTEST'), null);
  assert.equal(resolvePreset('John Smith'), null);
  assert.equal(resolvePreset('__proto__'), null, 'prototype keys are not presets either');
});

test('every preset resolves to a THEME operator, never free text', () => {
  for (const id of GDELT_PRESET_IDS) {
    const preset = resolvePreset(id);
    assert.ok(preset, `${id} must resolve`);
    assert.match(preset.query, /^theme:[A-Z_]+$/, `${id} must be a theme operator`);
    assert.ok(preset.label && preset.description && preset.accent, `${id} needs presentation fields`);
  }
});

test('the default preset is one of the presets', () => {
  assert.ok(GDELT_PRESET_IDS.includes(DEFAULT_GDELT_PRESET_ID));
});

test('preset ids and accents are unique', () => {
  assert.equal(new Set(GDELT_PRESET_IDS).size, GDELT_PRESETS.length);
  assert.equal(new Set(GDELT_PRESETS.map((p) => p.accent)).size, GDELT_PRESETS.length);
});

test('stripHtml reduces the article popup to bounded plain text', () => {
  const html = '<a href="http://example.test">Flooding hits <b>Valencia</b></a><br>More&nbsp;coverage &amp; updates';
  assert.equal(stripHtml(html), 'Flooding hits Valencia More coverage & updates');
});

test('stripHtml bounds length and never leaves markup for a label to render literally', () => {
  const long = `<p>${'x'.repeat(500)}</p>`;
  const result = stripHtml(long, 50);
  assert.equal(result.length, 50);
  assert.doesNotMatch(result, /[<>]/);
  assert.ok(result.endsWith('…'));
  assert.equal(stripHtml(''), null);
  assert.equal(stripHtml(null), null);
  assert.equal(stripHtml('<p></p>'), null, 'markup with no text is nothing, not empty markup');
});

test('a feature normalizes into a compact record', () => {
  const record = normalizeGdeltFeature(point(-0.37, 39.47, {
    name: 'Valencia, Spain', count: 42, html: '<b>Flooding</b>',
  }), 0);
  assert.equal(record.name, 'Valencia, Spain');
  assert.equal(record.lon, -0.37);
  assert.equal(record.mentions, 42);
  assert.equal(record.summary, 'Flooding');
});

test('MENTIONS ARE NOT EVENTS: the count field is named for what it is', () => {
  // GDELT counts how often a place was mentioned in matching coverage. A layer
  // that called this "events" would be inventing a fact.
  const record = normalizeGdeltFeature(point(0, 0, { name: 'X', count: 9 }), 0);
  assert.equal(record.mentions, 9);
  assert.equal(record.events, undefined);
  assert.equal(record.count, undefined);
});

test('a feature with no usable position is dropped', () => {
  assert.equal(normalizeGdeltFeature(null), null);
  assert.equal(normalizeGdeltFeature({ geometry: { type: 'Polygon', coordinates: [] } }), null);
  assert.equal(normalizeGdeltFeature(point(NaN, 10)), null);
  assert.equal(normalizeGdeltFeature(point(999, 10)), null, 'out-of-range longitude');
  assert.equal(normalizeGdeltFeature(point(10, -91)), null, 'out-of-range latitude');
});

test('an unnamed place is labelled unknown rather than blank', () => {
  const record = normalizeGdeltFeature(point(1, 1, { count: 3 }), 0);
  assert.equal(record.name, 'UNNAMED LOCATION');
});

test('a place with no count is one mention, not zero', () => {
  const record = normalizeGdeltFeature(point(1, 1, { name: 'X' }), 0);
  assert.equal(record.mentions, 1, 'it was returned, so it was mentioned at least once');
});

test('the collection is ordered by mentions so a cap keeps the loudest places', () => {
  const collection = {
    features: [
      point(1, 1, { name: 'quiet', count: 2 }),
      point(2, 2, { name: 'loud', count: 400 }),
      point(3, 3, { name: 'mid', count: 50 }),
    ],
  };
  const { records, maxMentions } = normalizeGdeltCollection(collection);
  assert.deepEqual(records.map((r) => r.name), ['loud', 'mid', 'quiet']);
  assert.equal(maxMentions, 400);
});

test('the record cap binds and is reported', () => {
  const features = Array.from({ length: 50 }, (_, i) => point(i / 10, 0, { name: `p${i}`, count: i }));
  const result = normalizeGdeltCollection({ features }, { maxRecords: 10 });
  assert.equal(result.records.length, 10);
  assert.equal(result.truncated, true);
  assert.equal(result.totalFeatures, 50, 'the real upstream count survives truncation');
});

test('an untruncated set does not claim truncation', () => {
  const result = normalizeGdeltCollection({ features: [point(0, 0, { name: 'a', count: 1 })] });
  assert.equal(result.truncated, false);
});

test('a malformed or empty payload yields an empty set rather than throwing', () => {
  for (const input of [null, {}, { features: null }, { features: [] }]) {
    const result = normalizeGdeltCollection(input);
    assert.deepEqual(result.records, []);
    assert.equal(result.truncated, false);
    assert.equal(result.maxMentions, 0);
  }
});

test('marker size scales logarithmically against the busiest place in the set', () => {
  // Mention counts are heavy-tailed: a linear ramp pins every ordinary place
  // to the floor beside one enormous dot.
  const peak = 10_000;
  const small = mentionPixelSize(10, peak);
  const mid = mentionPixelSize(500, peak);
  const large = mentionPixelSize(peak, peak);
  assert.ok(small < mid && mid < large, 'sizes stay ordered');
  assert.ok(small >= 5, 'nothing disappears');
  assert.ok(large <= 18, 'nothing becomes a blob');
  // A linear scale would put 10/10000 essentially at the floor; log keeps it visible.
  assert.ok(small > 5, 'a modestly reported place is still legible');
});

test('marker sizing survives degenerate inputs', () => {
  assert.equal(mentionPixelSize(0, 100), 5);
  assert.equal(mentionPixelSize(NaN, 100), 5);
  assert.equal(mentionPixelSize(5, 1), 8, 'a set with one place has no scale to speak of');
  assert.equal(mentionPixelSize(5, 0), 8);
});
