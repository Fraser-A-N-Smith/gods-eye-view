// ACLED event shape. Load-bearing: every record carries its "not
// independently verified" hedge (same discipline as the GFW vessel-events
// layer), a missing coordinate is dropped rather than guessed, geo_precision
// is never overclaimed, and the closed preset allowlist never forwards
// caller text to ACLED's event_type filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACLED_PRESETS,
  ACLED_PRESET_IDS,
  DEFAULT_ACLED_PRESET_ID,
  ACLED_CAVEAT,
  resolveAcledPreset,
  acledPrecisionFor,
  eventDateMsUtc,
  normalizeAcledEvent,
  normalizeAcledEvents,
  acledEventPixelSize,
} from './acledEventsShape.js';

test('CLOSED ALLOWLIST: presets map to ACLED event_type strings, never free text', () => {
  assert.equal(resolveAcledPreset('nope'), null);
  assert.equal(resolveAcledPreset(''), null);
  assert.equal(resolveAcledPreset(null), null);
  assert.equal(resolveAcledPreset('__proto__'), null);
  for (const id of ACLED_PRESET_IDS) {
    const preset = resolveAcledPreset(id);
    assert.ok(preset.eventType, `${id} needs an ACLED event_type value`);
    assert.ok(preset.label && preset.accent);
  }
});

test('the default preset is one of the presets, and ids/accents are unique', () => {
  assert.ok(ACLED_PRESET_IDS.includes(DEFAULT_ACLED_PRESET_ID));
  assert.equal(new Set(ACLED_PRESET_IDS).size, ACLED_PRESETS.length);
  assert.equal(new Set(ACLED_PRESETS.map((p) => p.accent)).size, ACLED_PRESETS.length);
});

test('acledPrecisionFor maps the codebook without overclaiming', () => {
  assert.equal(acledPrecisionFor(1), 'exact');
  assert.equal(acledPrecisionFor(2), 'approximate');
  assert.equal(acledPrecisionFor(3), 'regional');
  assert.equal(acledPrecisionFor(4), 'unknown');
  assert.equal(acledPrecisionFor(null), 'unknown');
});

test('eventDateMsUtc parses YYYY-MM-DD as UTC midnight', () => {
  assert.equal(eventDateMsUtc('2026-08-30'), Date.UTC(2026, 7, 30));
  assert.equal(eventDateMsUtc('2026-8-30'), null, 'must be zero-padded');
  assert.equal(eventDateMsUtc(''), null);
  assert.equal(eventDateMsUtc(null), null);
});

test('a raw event normalizes with the hedge attached, not just shown in chrome', () => {
  const preset = resolveAcledPreset('battles');
  const record = normalizeAcledEvent({
    event_id_cnty: 'XYZ1234',
    latitude: '48.8566',
    longitude: '2.3522',
    event_date: '2026-08-30',
    country: 'Testland',
    location: 'Testville',
    actor1: 'Faction A',
    actor2: 'Faction B',
    fatalities: '3',
    geo_precision: '1',
    source: 'Local news',
    notes: 'A clash occurred.',
  }, preset, 0);
  assert.equal(record.id, 'XYZ1234');
  assert.equal(record.type, 'battles');
  assert.equal(record.lat, 48.8566);
  assert.equal(record.precision, 'exact');
  assert.equal(record.fatalities, 3);
  assert.equal(record.caveat, ACLED_CAVEAT);
});

test('a missing coordinate is dropped, not guessed at (0,0)', () => {
  const preset = resolveAcledPreset('riots');
  assert.equal(normalizeAcledEvent({ event_id_cnty: 'a' }, preset), null);
  assert.equal(normalizeAcledEvent(null, preset), null);
});

test('out-of-range coordinates are dropped', () => {
  const preset = resolveAcledPreset('riots');
  assert.equal(normalizeAcledEvent({ latitude: '999', longitude: '2' }, preset), null);
});

test('a missing event_id falls back to a stable per-preset synthetic id', () => {
  const preset = resolveAcledPreset('protests');
  const record = normalizeAcledEvent({ latitude: '1', longitude: '1' }, preset, 7);
  assert.equal(record.id, 'protests-7');
});

test('normalizeAcledEvents accepts the {data:[...]} shape, orders most-recent-first, and caps with truncation reported', () => {
  const preset = resolveAcledPreset('battles');
  const payload = {
    data: [
      { event_id_cnty: 'old', latitude: '1', longitude: '1', event_date: '2026-01-01' },
      { event_id_cnty: 'new', latitude: '2', longitude: '2', event_date: '2026-08-30' },
      { event_id_cnty: 'mid', latitude: '3', longitude: '3', event_date: '2026-06-15' },
    ],
    count: 3,
  };
  const result = normalizeAcledEvents(payload, preset);
  assert.deepEqual(result.events.map((e) => e.id), ['new', 'mid', 'old']);
  assert.equal(result.truncated, false);
  assert.equal(result.total, 3);
});

test('normalizeAcledEvents caps and reports truncation against the real upstream total', () => {
  const preset = resolveAcledPreset('battles');
  const data = Array.from({ length: 10 }, (_, i) => ({
    event_id_cnty: `e${i}`, latitude: '1', longitude: '1', event_date: '2026-01-01',
  }));
  const result = normalizeAcledEvents({ data, count: 500 }, preset, { maxEvents: 3 });
  assert.equal(result.events.length, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.total, 500, 'the real upstream count survives truncation, not just the page size');
});

test('normalizeAcledEvents on empty/malformed input yields an empty set, not a throw', () => {
  const preset = resolveAcledPreset('battles');
  for (const input of [null, {}, { data: null }, { data: [] }]) {
    const result = normalizeAcledEvents(input, preset);
    assert.deepEqual(result.events, []);
    assert.equal(result.truncated, false);
  }
});

test('acledEventPixelSize never treats "unknown" as "zero"', () => {
  assert.equal(acledEventPixelSize(null), 6, 'unknown fatalities gets the flat size, not the floor');
  assert.equal(acledEventPixelSize(0), 5, 'a real zero-fatality event is smaller than "unknown"');
  assert.ok(acledEventPixelSize(50) > acledEventPixelSize(1));
  assert.ok(acledEventPixelSize(500) <= 18, 'nothing becomes a blob');
});
