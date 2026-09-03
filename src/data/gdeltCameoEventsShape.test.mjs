// GDELT Event 2.0 CAMEO layer shape. The load-bearing tests: the closed
// root-code allowlist (this is not free-text/actor search), positional
// parsing of a headerless export row, precision never overclaiming, and the
// rolling-buffer window math the proxy depends on to avoid re-fetching a
// full day of history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMEO_PRESETS,
  CAMEO_PRESET_IDS,
  DEFAULT_CAMEO_PRESET_ID,
  RELEVANT_ROOT_CODES,
  resolveCameoPreset,
  isRelevantRootCode,
  geoPrecisionFor,
  dateAddedMsUtc,
  formatIntervalId,
  parseIntervalId,
  previousIntervalId,
  exportUrlForInterval,
  parseLastUpdateText,
  parseCameoEventRow,
  parseCameoExport,
  pruneStaleIntervals,
  mergeIntervalRecords,
  sliceRecordsForPreset,
} from './gdeltCameoEventsShape.js';

/**
 * Build a syntactically valid 61-column export row (positional, tab-delimited,
 * no header) with only the fields this module reads populated meaningfully —
 * everything else is a plausible-looking placeholder, matching the real
 * export's shape without needing a full fixture file.
 */
function row({
  id = '1001',
  rootCode = '14',
  quadClass = '3',
  goldstein = '-5.0',
  numMentions = '7',
  actionLat = '48.8566',
  actionLon = '2.3522',
  actionGeoType = '4',
  actor1Lat = '',
  actor1Lon = '',
  actor1GeoType = '',
  dateAdded = '20260830123000',
  sourceUrl = 'https://example.test/article',
} = {}) {
  const cols = new Array(61).fill('');
  cols[0] = id;
  cols[28] = rootCode;
  cols[29] = quadClass;
  cols[30] = goldstein;
  cols[31] = numMentions;
  cols[35] = actor1GeoType;
  cols[40] = actor1Lat;
  cols[41] = actor1Lon;
  cols[51] = actionGeoType;
  cols[56] = actionLat;
  cols[57] = actionLon;
  cols[59] = dateAdded;
  cols[60] = sourceUrl;
  return cols.join('\t');
}

test('CLOSED ALLOWLIST: presets are theme→root-code tables, never free text', () => {
  assert.equal(resolveCameoPreset('nope'), null);
  assert.equal(resolveCameoPreset(''), null);
  assert.equal(resolveCameoPreset(null), null);
  assert.equal(resolveCameoPreset('__proto__'), null);
  for (const id of CAMEO_PRESET_IDS) {
    const preset = resolveCameoPreset(id);
    assert.ok(preset.rootCodes.length > 0, `${id} needs at least one root code`);
    for (const code of preset.rootCodes) assert.match(code, /^\d{2}$/, 'root codes are 2-digit CAMEO codes');
  }
});

test('the default preset is one of the presets, and ids/accents are unique', () => {
  assert.ok(CAMEO_PRESET_IDS.includes(DEFAULT_CAMEO_PRESET_ID));
  assert.equal(new Set(CAMEO_PRESET_IDS).size, CAMEO_PRESETS.length);
  assert.equal(new Set(CAMEO_PRESETS.map((p) => p.accent)).size, CAMEO_PRESETS.length);
});

test('isRelevantRootCode only accepts codes a preset actually uses', () => {
  for (const code of RELEVANT_ROOT_CODES) assert.equal(isRelevantRootCode(code), true);
  assert.equal(isRelevantRootCode('01'), false, 'appeal codes are not in any preset');
  assert.equal(isRelevantRootCode('14 '), false, 'must match exactly, not loosely');
  assert.equal(isRelevantRootCode(null), false);
});

test('geoPrecisionFor never overclaims resolution', () => {
  assert.equal(geoPrecisionFor(1), 'country');
  assert.equal(geoPrecisionFor(2), 'region');
  assert.equal(geoPrecisionFor(3), 'locality');
  assert.equal(geoPrecisionFor(4), 'locality');
  assert.equal(geoPrecisionFor(5), 'region');
  assert.equal(geoPrecisionFor(99), 'unknown');
  assert.equal(geoPrecisionFor(null), 'unknown');
});

test('dateAddedMsUtc parses the 14-digit DATEADDED field as UTC', () => {
  assert.equal(dateAddedMsUtc('20260830123045'), Date.UTC(2026, 7, 30, 12, 30, 45));
  assert.ok(Number.isNaN(dateAddedMsUtc('2026083012')), 'too short is rejected');
  assert.ok(Number.isNaN(dateAddedMsUtc('')), 'empty is rejected');
  assert.ok(Number.isNaN(dateAddedMsUtc(null)));
});

test('interval id round-trips through format/parse and steps back 15 minutes', () => {
  const ms = Date.UTC(2026, 7, 30, 12, 30, 0);
  const id = formatIntervalId(ms);
  assert.equal(id, '20260830123000');
  assert.equal(parseIntervalId(id), ms);
  assert.equal(previousIntervalId(id), '20260830121500');
  assert.equal(previousIntervalId(id, 4), '20260830113000');
  assert.equal(previousIntervalId('not-an-id'), null);
});

test('exportUrlForInterval builds the real GDELT bulk-download URL shape', () => {
  assert.equal(
    exportUrlForInterval('20260830123000'),
    'https://data.gdeltproject.org/gdeltv2/20260830123000.export.CSV.zip',
  );
});

test('parseLastUpdateText finds the export line among mentions/gkg siblings', () => {
  const text = [
    '123456 aabbcc https://data.gdeltproject.org/gdeltv2/20260830123000.export.CSV.zip',
    '654321 ddeeff https://data.gdeltproject.org/gdeltv2/20260830123000.mentions.CSV.zip',
    '111222 gghhii https://data.gdeltproject.org/gdeltv2/20260830123000.gkg.csv.zip',
  ].join('\n');
  const result = parseLastUpdateText(text);
  assert.equal(result.intervalId, '20260830123000');
  assert.match(result.url, /\.export\.CSV\.zip$/);
});

test('parseLastUpdateText returns null when nothing matches', () => {
  assert.equal(parseLastUpdateText(''), null);
  assert.equal(parseLastUpdateText('garbage\nmore garbage'), null);
  assert.equal(parseLastUpdateText(null), null);
});

test('a relevant row parses into a compact record with ActionGeo position', () => {
  const record = parseCameoEventRow(row());
  assert.equal(record.id, 'gdelt-cameo-1001');
  assert.equal(record.rootCode, '14');
  assert.equal(record.quadClass, 3);
  assert.equal(record.goldstein, -5);
  assert.equal(record.numMentions, 7);
  assert.equal(record.lat, 48.8566);
  assert.equal(record.lon, 2.3522);
  assert.equal(record.precision, 'locality');
  assert.equal(record.sourceUrl, 'https://example.test/article');
  assert.equal(record.dateMs, Date.UTC(2026, 7, 30, 12, 30, 0));
});

test('an irrelevant root code is dropped even with a perfectly good position', () => {
  assert.equal(parseCameoEventRow(row({ rootCode: '01' })), null);
});

test('too few columns is dropped rather than mis-parsed', () => {
  assert.equal(parseCameoEventRow('a\tb\tc'), null);
  assert.equal(parseCameoEventRow(''), null);
  assert.equal(parseCameoEventRow(null), null);
});

test('ACTION GEO FIRST, ACTOR1 GEO FALLBACK: a blank action position falls back to the actor', () => {
  const record = parseCameoEventRow(row({
    actionLat: '', actionLon: '', actionGeoType: '',
    actor1Lat: '51.5074', actor1Lon: '-0.1278', actor1GeoType: '1',
  }));
  assert.equal(record.lat, 51.5074);
  assert.equal(record.lon, -0.1278);
  assert.equal(record.precision, 'country', 'the fallback source\'s own geo-type is used, not a guess');
});

test('a row with no usable position at all is dropped', () => {
  assert.equal(parseCameoEventRow(row({ actionLat: '', actionLon: '', actor1Lat: '', actor1Lon: '' })), null);
});

test('out-of-range coordinates are dropped', () => {
  assert.equal(parseCameoEventRow(row({ actionLat: '999', actionLon: '2' })), null);
});

test('a row with no NumMentions is one mention, not zero', () => {
  const record = parseCameoEventRow(row({ numMentions: '' }));
  assert.equal(record.numMentions, 1);
});

test('parseCameoExport tolerates CRLF, blank lines, and malformed rows', () => {
  const body = [row({ id: '1' }), '', row({ id: '2', rootCode: '99' }), row({ id: '3' })].join('\r\n');
  const records = parseCameoExport(body);
  assert.deepEqual(records.map((r) => r.id), ['gdelt-cameo-1', 'gdelt-cameo-3']);
});

test('parseCameoExport on empty/malformed input yields an empty array, not a throw', () => {
  assert.deepEqual(parseCameoExport(''), []);
  assert.deepEqual(parseCameoExport(null), []);
  assert.deepEqual(parseCameoExport('<html>error</html>'), []);
});

test('pruneStaleIntervals drops anything older than the rolling window', () => {
  const now = Date.UTC(2026, 7, 30, 15, 0, 0);
  const entries = [
    { intervalId: 'a', intervalMs: now - 30 * 60_000, records: [] },
    { intervalId: 'b', intervalMs: now - 4 * 3600_000, records: [] },
  ];
  const kept = pruneStaleIntervals(entries, now, 3 * 3600_000);
  assert.deepEqual(kept.map((e) => e.intervalId), ['a']);
});

test('pruneStaleIntervals is defensive against a malformed buffer', () => {
  assert.deepEqual(pruneStaleIntervals(null, 0, 1000), []);
  assert.deepEqual(pruneStaleIntervals([{ intervalId: 'x' }], 0, 1000), []);
});

test('mergeIntervalRecords dedupes by id across intervals, most recent wins', () => {
  const entries = [
    { records: [{ id: 'x', numMentions: 1 }] },
    { records: [{ id: 'x', numMentions: 9 }, { id: 'y', numMentions: 2 }] },
  ];
  const merged = mergeIntervalRecords(entries);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((r) => r.id === 'x').numMentions, 9);
});

test('sliceRecordsForPreset filters by root code, orders by mentions, and caps with truncation reported', () => {
  const records = [
    { id: 'a', rootCode: '14', numMentions: 5 },
    { id: 'b', rootCode: '18', numMentions: 50 },
    { id: 'c', rootCode: '14', numMentions: 20 },
  ];
  const unrest = sliceRecordsForPreset(records, 'unrest');
  assert.deepEqual(unrest.records.map((r) => r.id), ['c', 'a']);
  assert.equal(unrest.truncated, false);
  assert.equal(unrest.totalFeatures, 2);

  const conflict = sliceRecordsForPreset(records, 'conflict', { maxRecords: 0 });
  assert.equal(conflict.records.length, 0);
  assert.equal(conflict.truncated, true);
  assert.equal(conflict.totalFeatures, 1);
});

test('sliceRecordsForPreset refuses an unknown preset rather than returning everything', () => {
  const result = sliceRecordsForPreset([{ id: 'a', rootCode: '14', numMentions: 1 }], 'nope');
  assert.deepEqual(result, { records: [], truncated: false, totalFeatures: 0 });
});
