// Maidenhead grid decoder + PSKReporter XML parser — the single
// implementation shared by the /api/ham-radio proxy (vite.config.js) and the
// hamRadioPropagation.js layer. Testing it here, once, against its one real
// implementation is what makes server/client drift impossible rather than
// merely discouraged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maidenheadToLatLon, parsePskReporterXml } from './hamRadioPropagationShape.js';

test('maidenheadToLatLon: 4-char locator decodes to the field/square center', () => {
  // FN20 is the standard Maidenhead worked example: the square bounded by
  // 40N-41N and 74W-76W (Wikipedia's own example computation), so its
  // center is 40.5N, 75W — not the square's eastern edge.
  const { lat, lon } = maidenheadToLatLon('FN20');
  assert.ok(Math.abs(lat - 40.5) < 0.01);
  assert.ok(Math.abs(lon - -75) < 0.01);
});

test('maidenheadToLatLon: 6-char locator resolves to sub-square precision', () => {
  const four = maidenheadToLatLon('JO33');
  const six = maidenheadToLatLon('JO33ki');
  assert.notEqual(four.lat, six.lat);
  assert.ok(Math.abs(six.lat - four.lat) < 1);
});

test('maidenheadToLatLon: lowercase input decodes identically to uppercase', () => {
  assert.deepEqual(maidenheadToLatLon('jo33ki'), maidenheadToLatLon('JO33KI'));
});

test('maidenheadToLatLon: 8-char locator resolves to the same center as its 6-char prefix', () => {
  // The extra subsquare digits refine no further than sub-square precision
  // in this decoder — the center returned is the same cell either way.
  assert.deepEqual(maidenheadToLatLon('JO33ki90'), maidenheadToLatLon('JO33ki'));
});

test('maidenheadToLatLon: invalid input returns null, never throws', () => {
  assert.equal(maidenheadToLatLon(''), null);
  assert.equal(maidenheadToLatLon('12'), null);
  assert.equal(maidenheadToLatLon('ZZ'), null);
  assert.equal(maidenheadToLatLon(null), null);
  assert.equal(maidenheadToLatLon(undefined), null);
  assert.equal(maidenheadToLatLon(42), null);
});

test('parsePskReporterXml: extracts reception reports and decodes both locators', () => {
  const xml = '<receptionReports currentSeconds="1"><receptionReport receiverCallsign="PE1OID" receiverLocator="JO33ki90" senderCallsign="CU2AP" senderLocator="HM77ET" frequency="18102364" flowStartSeconds="1788091549" mode="FT8" sNR="-13" /></receptionReports>';
  const spots = parsePskReporterXml(xml);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].senderCallsign, 'CU2AP');
  assert.equal(spots[0].receiverCallsign, 'PE1OID');
  assert.equal(spots[0].frequencyHz, 18102364);
  assert.equal(spots[0].mode, 'FT8');
  assert.equal(spots[0].snr, -13);
  assert.equal(spots[0].flowStartSeconds, 1788091549);
  assert.ok(Number.isFinite(spots[0].senderLat) && Number.isFinite(spots[0].senderLon));
  assert.ok(Number.isFinite(spots[0].receiverLat) && Number.isFinite(spots[0].receiverLon));
});

test('parsePskReporterXml: a record with an undecodable locator is dropped, not crashed on', () => {
  const xml = '<receptionReports currentSeconds="1"><receptionReport receiverCallsign="X" receiverLocator="ZZ" senderCallsign="Y" senderLocator="JO33ki90" frequency="1" flowStartSeconds="1" mode="FT8" sNR="0" /></receptionReports>';
  assert.equal(parsePskReporterXml(xml).length, 0);
});

test('parsePskReporterXml: parses multiple reports and keeps only the decodable ones', () => {
  const xml = [
    '<receptionReports currentSeconds="2">',
    '<receptionReport receiverCallsign="A1" receiverLocator="JO33ki" senderCallsign="B1" senderLocator="FN20" frequency="14074000" flowStartSeconds="100" mode="FT8" sNR="5" />',
    '<receptionReport receiverCallsign="A2" receiverLocator="ZZ" senderCallsign="B2" senderLocator="FN20" frequency="14074000" flowStartSeconds="200" mode="FT8" sNR="-2" />',
    '<receptionReport receiverCallsign="A3" receiverLocator="JO33ki" senderCallsign="B3" senderLocator="FN20" frequency="14074000" flowStartSeconds="300" mode="FT8" sNR="10" />',
    '</receptionReports>',
  ].join('');
  const spots = parsePskReporterXml(xml);
  assert.equal(spots.length, 2);
  assert.deepEqual(spots.map((s) => s.receiverCallsign), ['A1', 'A3']);
});

test('parsePskReporterXml: missing numeric attributes become null, never NaN', () => {
  const xml = '<receptionReports currentSeconds="1"><receptionReport receiverCallsign="A" receiverLocator="JO33ki" senderCallsign="B" senderLocator="FN20" mode="FT8" /></receptionReports>';
  const [spot] = parsePskReporterXml(xml);
  assert.equal(spot.frequencyHz, null);
  assert.equal(spot.snr, null);
  for (const [key, value] of Object.entries(spot)) {
    assert.notEqual(value, undefined, `${key} must not be undefined`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} must not be NaN`);
  }
});

test('parsePskReporterXml: caps at 200 records even when the upstream sends more', () => {
  const reports = Array.from({ length: 250 }, (_, i) => (
    `<receptionReport receiverCallsign="R${i}" receiverLocator="JO33ki" senderCallsign="S${i}" senderLocator="FN20" frequency="14074000" flowStartSeconds="${i}" mode="FT8" sNR="0" />`
  )).join('');
  const xml = `<receptionReports currentSeconds="1">${reports}</receptionReports>`;
  assert.equal(parsePskReporterXml(xml).length, 200);
});

test('parsePskReporterXml: non-string/empty input yields an empty array, never throws', () => {
  assert.deepEqual(parsePskReporterXml(null), []);
  assert.deepEqual(parsePskReporterXml(undefined), []);
  assert.deepEqual(parsePskReporterXml(''), []);
  assert.deepEqual(parsePskReporterXml(42), []);
  assert.deepEqual(parsePskReporterXml('<receptionReports></receptionReports>'), []);
});

test('parsePskReporterXml: output is JSON-safe', () => {
  const xml = '<receptionReports currentSeconds="1"><receptionReport receiverCallsign="PE1OID" receiverLocator="JO33ki90" senderCallsign="CU2AP" senderLocator="HM77ET" frequency="18102364" flowStartSeconds="1788091549" mode="FT8" sNR="-13" /></receptionReports>';
  const [spot] = parsePskReporterXml(xml);
  assert.deepEqual(JSON.parse(JSON.stringify(spot)), spot);
});
