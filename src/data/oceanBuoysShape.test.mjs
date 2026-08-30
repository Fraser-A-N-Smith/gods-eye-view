// NDBC fixed-width text parser — the single implementation shared by the
// /api/ocean-buoys proxy (vite.config.js) and the oceanBuoys.js layer.
// Testing it here, once, against its one real implementation is what makes
// server/client drift impossible rather than merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNdbcLine, parseNdbcText } from './oceanBuoysShape.js';

test('parseNdbcLine: parses a well-formed data row', () => {
  const line = '22101    37.24   126.02  2026 08 30 11 00  20   1.0    MM  0.0   0   MM  MM     MM    MM  25.0  26.2    MM   MM     MM';
  assert.deepEqual(parseNdbcLine(line), {
    id: '22101', lat: 37.24, lon: 126.02,
    windSpeedMs: 1.0, waveHeightM: 0.0, airTempC: 25.0, waterTempC: 26.2,
  });
});

test('parseNdbcLine: "MM" missing markers become null, never NaN', () => {
  // 8 header/id/date fields + 14 MM-marked data fields = the full 22-column
  // NDBC row (stn lat lon yyyy mm dd hh mn wdir wspd gst wvht dpd apd mwd
  // pres ptdy atmp wtmp dewp vis tide) — a short row is rejected as
  // malformed by design, so this fixture must carry every column.
  const r = parseNdbcLine('99999 10.0 -20.0 2026 01 01 00 00 MM MM MM MM MM MM MM MM MM MM MM MM MM MM');
  assert.equal(r.windSpeedMs, null);
  assert.equal(r.waveHeightM, null);
  assert.equal(r.airTempC, null);
  assert.equal(r.waterTempC, null);
  for (const v of Object.values(r)) assert.notEqual(v, undefined);
});

test('parseNdbcLine: header lines and short lines return null', () => {
  assert.equal(parseNdbcLine('#STN LAT LON'), null);
  assert.equal(parseNdbcLine(''), null);
  assert.equal(parseNdbcLine('short line'), null);
  assert.equal(parseNdbcLine(null), null);
  assert.equal(parseNdbcLine(undefined), null);
});

test('parseNdbcLine: non-finite coordinates are rejected', () => {
  assert.equal(
    parseNdbcLine('22101 not-a-number 126.02 2026 08 30 11 00 20 1.0 MM 0.0 0 MM MM MM MM 25.0 26.2 MM MM MM'),
    null,
  );
});

test('parseNdbcLine: output is JSON-safe', () => {
  const line = '22101 37.24 126.02 2026 08 30 11 00 20 1.0 MM 0.0 0 MM MM MM MM 25.0 26.2 MM MM MM';
  const r = parseNdbcLine(line);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});

test('parseNdbcText: skips headers, parses data rows, drops malformed ones', () => {
  const text = [
    '#STN LAT LON header',
    '#text units header',
    '22101 37.24 126.02 2026 08 30 11 00 20 1.0 MM 0.0 0 MM MM MM MM 25.0 26.2 MM MM MM',
    '',
  ].join('\n');
  const rows = parseNdbcText(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '22101');
});

test('parseNdbcText: parses multiple data rows and drops a malformed one in the middle', () => {
  const text = [
    '#STN LAT LON header',
    '#text units header',
    '22101 37.24 126.02 2026 08 30 11 00 20 1.0 MM 0.0 0 MM MM MM MM 25.0 26.2 MM MM MM',
    'short line',
    '46042 36.79 -122.42 2026 08 30 11 00 MM MM MM MM MM MM MM MM MM 15.0 14.5 MM MM MM',
  ].join('\n');
  const rows = parseNdbcText(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), ['22101', '46042']);
});

test('parseNdbcText: non-string input yields an empty array', () => {
  assert.deepEqual(parseNdbcText(null), []);
  assert.deepEqual(parseNdbcText(undefined), []);
  assert.deepEqual(parseNdbcText(42), []);
});
