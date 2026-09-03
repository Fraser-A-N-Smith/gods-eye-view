// WHO DON normalizer — the single implementation shared by the
// /api/disease-outbreaks proxy (vite.config.js) and the diseaseOutbreaks.js
// layer. Testing it here, once, against its one real implementation is what
// makes server/client drift impossible rather than merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDiseaseOutbreakEntry, mapDiseaseOutbreakFeed } from './diseaseOutbreaksShape.js';
import { findCountryCentroid } from './countryCentroids.js';

test('mapDiseaseOutbreakEntry: maps a well-formed entry', () => {
  const r = mapDiseaseOutbreakEntry({
    Title: 'Marburg virus disease – Rwanda', Country: 'Rwanda',
    PublicationDateAndTime: '2026-08-15T00:00:00Z', UrlName: 'marburg-virus-disease-rwanda',
  });
  assert.equal(r.title, 'Marburg virus disease – Rwanda');
  assert.equal(r.country, 'Rwanda');
  assert.deepEqual([r.lat, r.lon], findCountryCentroid('Rwanda'));
  assert.equal(r.publishedAt, '2026-08-15T00:00:00.000Z');
  assert.equal(r.url, 'https://www.who.int/emergencies/disease-outbreak-news/item/marburg-virus-disease-rwanda');
});

test('mapDiseaseOutbreakEntry: accepts alternate field name spellings', () => {
  const r = mapDiseaseOutbreakEntry({ title: 'Cholera – Example', country: 'Kenya' });
  assert.equal(r.title, 'Cholera – Example');
  assert.equal(r.country, 'Kenya');
});

test('mapDiseaseOutbreakEntry: an unmatched country is dropped, not plotted with a guess', () => {
  assert.equal(mapDiseaseOutbreakEntry({ Title: 'Test', Country: 'Wakanda' }), null);
});

test('mapDiseaseOutbreakEntry: rejects a missing title or country', () => {
  assert.equal(mapDiseaseOutbreakEntry({ Country: 'Kenya' }), null);
  assert.equal(mapDiseaseOutbreakEntry({ Title: 'Test' }), null);
  assert.equal(mapDiseaseOutbreakEntry(null), null);
});

test('mapDiseaseOutbreakEntry: rejects an unparseable date and an unsafe URL scheme without crashing', () => {
  const r = mapDiseaseOutbreakEntry({ Title: 'Test', Country: 'Kenya', PublicationDateAndTime: 'not-a-date', url: 'javascript:alert(1)' });
  assert.equal(r.publishedAt, null);
  assert.equal(r.url, null);
});

test('mapDiseaseOutbreakEntry: output is JSON-safe', () => {
  const r = mapDiseaseOutbreakEntry({ Title: 'Test', Country: 'Kenya' });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test('mapDiseaseOutbreakFeed: maps a bare array, a {value:[...]} wrapper, and a {result:[...]} wrapper', () => {
  const entry = { Title: 'Test', Country: 'Kenya' };
  assert.equal(mapDiseaseOutbreakFeed([entry]).length, 1);
  assert.equal(mapDiseaseOutbreakFeed({ value: [entry] }).length, 1);
  assert.equal(mapDiseaseOutbreakFeed({ result: [entry] }).length, 1);
});

test('mapDiseaseOutbreakFeed: drops unmatched entries and caps at maxCount', () => {
  const entries = [
    { Title: 'A', Country: 'Kenya' },
    { Title: 'B', Country: 'Wakanda' },
    { Title: 'C', Country: 'Nigeria' },
  ];
  assert.equal(mapDiseaseOutbreakFeed(entries).length, 2);
  assert.equal(mapDiseaseOutbreakFeed(entries, 1).length, 1);
});

test('mapDiseaseOutbreakFeed: non-array/malformed payloads yield an empty array', () => {
  assert.deepEqual(mapDiseaseOutbreakFeed(null), []);
  assert.deepEqual(mapDiseaseOutbreakFeed(undefined), []);
  assert.deepEqual(mapDiseaseOutbreakFeed({}), []);
  assert.deepEqual(mapDiseaseOutbreakFeed('not an object'), []);
});
