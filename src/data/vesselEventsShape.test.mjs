// Global Fishing Watch vessel events. Everything here is a MODELLED
// interpretation of AIS tracks, never an observed act, and the tests hold the
// module to carrying that hedge on every record rather than leaving it to the
// UI to remember.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VESSEL_EVENT_PRESETS,
  VESSEL_EVENT_PRESET_IDS,
  DEFAULT_VESSEL_EVENT_PRESET_ID,
  resolveVesselEventPreset,
  vesselName,
  durationHours,
  normalizeVesselEvent,
  normalizeVesselEvents,
  eventPixelSize,
} from './vesselEventsShape.js';

const gaps = resolveVesselEventPreset('gaps');

test('CLOSED ALLOWLIST: only known preset ids resolve', () => {
  assert.equal(resolveVesselEventPreset('nope'), null);
  assert.equal(resolveVesselEventPreset('public-global-gaps-events:latest'), null,
    'a raw dataset string is not a preset id');
  assert.equal(resolveVesselEventPreset(null), null);
  assert.equal(resolveVesselEventPreset(42), null);
});

test('EVERY preset carries a hedge — apparent, not confirmed', () => {
  // GFW is emphatic that its classifications are apparent. Putting the caveat
  // on the preset means no code path can render an event without it.
  for (const preset of VESSEL_EVENT_PRESETS) {
    assert.ok(preset.caveat && preset.caveat.length > 15, `${preset.id} needs a caveat`);
    assert.match(preset.caveat, /APPARENT|INFERRED/, `${preset.id} must hedge explicitly`);
    assert.match(preset.dataset, /^public-global-/, `${preset.id} must use a public dataset`);
  }
});

test('the AIS gap caveat names the innocent explanation too', () => {
  // A gap can be a disabled transponder or a satellite coverage hole. Only
  // naming the sinister reading would be an accusation.
  assert.match(gaps.caveat, /COVERAGE HOLE/);
});

test('the default preset exists and preset ids are unique', () => {
  assert.ok(VESSEL_EVENT_PRESET_IDS.includes(DEFAULT_VESSEL_EVENT_PRESET_ID));
  assert.equal(new Set(VESSEL_EVENT_PRESET_IDS).size, VESSEL_EVENT_PRESETS.length);
  assert.equal(new Set(VESSEL_EVENT_PRESETS.map((p) => p.accent)).size, VESSEL_EVENT_PRESETS.length);
});

test('vessel names are read across the shapes GFW uses', () => {
  assert.equal(vesselName({ vessel: { name: 'ALPHA' } }), 'ALPHA');
  assert.equal(vesselName({ vessel: { shipname: 'BETA' } }), 'BETA');
  assert.equal(vesselName({ vessels: [{ name: 'GAMMA' }] }), 'GAMMA');
});

test('AN UNKNOWN VESSEL IS NULL, never its opaque id', () => {
  // Rendering an internal id where a name belongs makes a card look
  // authoritative about something it does not know.
  assert.equal(vesselName({ id: 'abc123def' }), null);
  assert.equal(vesselName({ vessel: { id: 'abc123def' } }), null);
  assert.equal(vesselName({}), null);
  assert.equal(vesselName(null), null);
});

test('durations are computed in hours, and refuse impossible ranges', () => {
  assert.equal(durationHours('2026-08-30T00:00:00Z', '2026-08-30T12:00:00Z'), 12);
  assert.equal(durationHours('2026-08-30T12:00:00Z', '2026-08-30T00:00:00Z'), null, 'end before start');
  assert.equal(durationHours('nonsense', '2026-08-30T00:00:00Z'), null);
  assert.equal(durationHours(null, null), null);
});

test('an event normalizes with its position, duration and hedge', () => {
  const event = normalizeVesselEvent({
    id: 'evt-1',
    position: { lat: -12.5, lon: 145.2 },
    start: '2026-08-29T00:00:00Z',
    end: '2026-08-29T18:00:00Z',
    vessel: { name: 'FV EXAMPLE', flag: 'PAN' },
  }, gaps, 0);
  assert.equal(event.lat, -12.5);
  assert.equal(event.durationHours, 18);
  assert.equal(event.vessel, 'FV EXAMPLE');
  assert.equal(event.flag, 'PAN');
  assert.equal(event.type, 'gaps');
  assert.equal(event.caveat, gaps.caveat, 'the hedge travels with the record');
});

test('an event with no position is dropped', () => {
  assert.equal(normalizeVesselEvent({ id: 'x' }, gaps), null);
  assert.equal(normalizeVesselEvent({ position: { lat: 999, lon: 0 } }, gaps), null);
  assert.equal(normalizeVesselEvent(null, gaps), null);
});

test('flat lat/lon entries normalize too', () => {
  const event = normalizeVesselEvent({ lat: 10, lon: 20 }, gaps, 3);
  assert.equal(event.lat, 10);
  assert.equal(event.id, 'gaps-3', 'a missing id falls back to a stable local one');
});

test('events order longest-first — duration IS the signal for a gap', () => {
  const payload = {
    entries: [
      { id: 'short', lat: 1, lon: 1, start: '2026-08-29T00:00:00Z', end: '2026-08-29T00:20:00Z' },
      { id: 'long', lat: 2, lon: 2, start: '2026-08-29T00:00:00Z', end: '2026-08-29T12:00:00Z' },
    ],
  };
  const { events } = normalizeVesselEvents(payload, gaps);
  assert.deepEqual(events.map((e) => e.id), ['long', 'short']);
});

test('the cap binds and the real total survives it', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: `e${i}`, lat: i / 10, lon: 0 }));
  const result = normalizeVesselEvents({ entries, total: 4210 }, gaps, { maxEvents: 5 });
  assert.equal(result.events.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.total, 4210);
});

test('a bare array response is accepted as well as the enveloped form', () => {
  const result = normalizeVesselEvents([{ id: 'a', lat: 1, lon: 1 }], gaps);
  assert.equal(result.events.length, 1);
});

test('a malformed payload yields no events rather than throwing', () => {
  for (const input of [null, {}, { entries: null }, 'nope']) {
    const result = normalizeVesselEvents(input, gaps);
    assert.deepEqual(result.events, []);
    assert.equal(result.truncated, false);
  }
});

test('marker size grows with duration and saturates rather than eating the map', () => {
  const brief = eventPixelSize(0.5);
  const day = eventPixelSize(24);
  const fortnight = eventPixelSize(336);
  const absurd = eventPixelSize(100_000);
  assert.ok(brief < day && day < fortnight);
  assert.ok(absurd <= 16, 'the scale saturates');
  assert.equal(eventPixelSize(null), 6, 'an unknown duration still renders');
  assert.equal(eventPixelSize(0), 6);
});
