// The scrub bar's presentation rules. What is pinned here is what the bar is
// allowed to CLAIM: it must not present a memory-shortened window as the one
// the operator asked for, must not imply a layer has history it was switched
// off for, and must distinguish an interpolated position from a held last fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusLine,
  coverageChips,
  caveatLine,
  formatClock,
  formatDuration,
  exportFilename,
} from './timelineUi.js';

const t0 = Date.UTC(2026, 7, 29, 14, 30, 0);
const range = { startMs: t0, endMs: t0 + 600_000, spanMs: 600_000 };

const liveTransport = { mode: 'live', playing: false, rate: 1, loop: false, positionMs: null, fraction: 1 };
const replayAt = (ms) => ({ mode: 'replay', playing: true, rate: 1, loop: false, positionMs: ms, fraction: 0.5 });

test('formatClock renders a zulu wall clock', () => {
  assert.equal(formatClock(t0), '14:30:00Z');
  assert.equal(formatClock(t0 + 3_661_000), '15:31:01Z');
  assert.equal(formatClock(NaN), '--:--:--Z');
});

test('formatDuration scales from seconds to hours', () => {
  assert.equal(formatDuration(8_000), '8s');
  assert.equal(formatDuration(260_000), '4m 20s');
  assert.equal(formatDuration(300_000), '5m');
  assert.equal(formatDuration(3_720_000), '1h 02m');
  assert.equal(formatDuration(-1), '--');
});

test('LIVE reports how much history is banked, not a fixed window size', () => {
  const status = statusLine({ transport: liveTransport, range });
  assert.equal(status.mode, 'LIVE');
  assert.equal(status.clock, formatClock(range.endMs));
  assert.equal(status.detail, '10m BUFFERED');
});

test('with nothing recorded the bar says so rather than showing an empty window', () => {
  const status = statusLine({ transport: liveTransport, range: null });
  assert.equal(status.detail, 'NO HISTORY BUFFERED YET');
});

test('REPLAY names all three ways a frame can be derived, distinctly', () => {
  const observed = statusLine({
    transport: replayAt(t0 + 300_000), range, frameMode: 'observed', count: 412,
  });
  assert.equal(observed.mode, 'REPLAY');
  assert.match(observed.detail, /OBSERVED FIX/, 'landing on a recorded frame is the strongest state');
  assert.match(observed.detail, /412 CONTACTS/);

  const interpolated = statusLine({ transport: replayAt(t0 + 300_000), range, frameMode: 'interpolated' });
  assert.match(interpolated.detail, /INTERPOLATED/);

  const held = statusLine({ transport: replayAt(t0 + 300_000), range, frameMode: 'held' });
  assert.match(held.detail, /HELD LAST FIX/, 'a stalled contact must not read as a tracked one');

  // The three must not collapse into each other.
  const details = new Set([observed.detail, interpolated.detail, held.detail]);
  assert.equal(details.size, 3);
});

test('an unknown frame mode degrades to the most cautious label', () => {
  const status = statusLine({ transport: replayAt(t0 + 1000), range, frameMode: 'nonsense' });
  assert.match(status.detail, /HELD LAST FIX/);
});

test('REPLAY reports how far back the head is', () => {
  const status = statusLine({ transport: replayAt(range.endMs - 125_000), range });
  assert.match(status.detail, /^-2m 05s/);
  assert.equal(status.clock, formatClock(range.endMs - 125_000));
});

test('coverage chips report each source OWN span, not the buffer extent', () => {
  const chips = coverageChips([
    { sourceId: 'flights', startMs: range.startMs, endMs: range.endMs, frames: 40, truncated: false },
    { sourceId: 'ais-live-vessels', startMs: range.endMs - 120_000, endMs: range.endMs, frames: 8, truncated: false },
  ], range);
  const byId = Object.fromEntries(chips.map((c) => [c.sourceId, c]));
  assert.equal(byId.flights.text, '10m');
  assert.equal(byId.flights.partial, false);
  assert.equal(byId['ais-live-vessels'].text, '2m');
  assert.equal(byId['ais-live-vessels'].partial, true, 'a late layer is flagged as partial');
  assert.equal(byId['ais-live-vessels'].label, 'VESSELS');
});

test('a source that stopped early is partial too', () => {
  const chips = coverageChips([
    { sourceId: 'flights', startMs: range.startMs, endMs: range.endMs - 200_000, frames: 20, truncated: false },
  ], range);
  assert.equal(chips[0].partial, true, 'switched off midway is still a gap');
});

test('a single missed tick is not flagged as partial coverage', () => {
  const chips = coverageChips([
    { sourceId: 'flights', startMs: range.startMs + 400, endMs: range.endMs - 400, frames: 40, truncated: false },
  ], range);
  assert.equal(chips[0].partial, false);
});

test('DISCLOSES: a memory-shortened window is admitted, not presented as intact', () => {
  const caveat = caveatLine({ buffer: { budgetLimited: true }, chips: [] });
  assert.match(caveat, /MEMORY BUDGET/);
});

test('DISCLOSES: a per-frame cap admits not every contact is recorded', () => {
  const caveat = caveatLine({
    buffer: { budgetLimited: false },
    chips: [{ label: 'FLIGHTS', partial: false, truncated: true }],
  });
  assert.match(caveat, /FLIGHTS CAPPED PER FRAME/);
  assert.match(caveat, /NOT EVERY CONTACT IS RECORDED/);
});

test('DISCLOSES: partial coverage names the layers it applies to', () => {
  const caveat = caveatLine({
    buffer: { budgetLimited: false },
    chips: [
      { label: 'VESSELS', partial: true, truncated: false },
      { label: 'FLIGHTS', partial: false, truncated: false },
    ],
  });
  assert.match(caveat, /VESSELS COVER ONLY PART/);
  assert.doesNotMatch(caveat, /FLIGHTS/, 'a fully covered layer is not accused of a gap');
});

test('no caveat is shown when there is nothing to disclose', () => {
  const caveat = caveatLine({
    buffer: { budgetLimited: false },
    chips: [{ label: 'FLIGHTS', partial: false, truncated: false }],
  });
  assert.equal(caveat, null, 'permanent boilerplate trains people to ignore the line');
});

test('a truncated source is not double-reported as partial', () => {
  const caveat = caveatLine({
    buffer: {},
    chips: [{ label: 'FLIGHTS', partial: true, truncated: true }],
  });
  assert.equal((caveat.match(/FLIGHTS/g) || []).length, 1);
});

test('coverage chips are inert without a range', () => {
  assert.deepEqual(coverageChips([{ sourceId: 'flights', startMs: 0, endMs: 1 }], null), []);
  assert.deepEqual(coverageChips(null, range), []);
});

test('export filenames are filesystem-safe and time-stamped', () => {
  const name = exportFilename(t0);
  assert.match(name, /^gev-timeline-[\dTZ-]+\.json$/);
  assert.doesNotMatch(name, /[:]/, 'colons break Windows filenames');
});
