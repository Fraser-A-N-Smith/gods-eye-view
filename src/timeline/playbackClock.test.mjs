// PlaybackClock — the transport half of the scrubber. The behaviours worth
// pinning are the ones that would otherwise make a replay look like a live
// feed: running off the end returns to LIVE instead of freezing, and a head
// that falls off the back of an evicting window is carried forward rather than
// left sampling outside the recorded range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock, normalizeRate, PLAYBACK_RATES } from './playbackClock.js';

const t0 = 1_700_000_000_000;
const range = { startMs: t0, endMs: t0 + 60_000 };

test('a fresh clock is live, paused, and holds no position', () => {
  const clock = new PlaybackClock();
  assert.equal(clock.mode, 'live');
  assert.equal(clock.playing, false);
  assert.equal(clock.positionMs, null);
  assert.equal(clock.isReplaying, false);
  assert.equal(clock.fraction(range), 1, 'live sits at the right-hand edge');
});

test('seek enters replay and clamps into the recorded range', () => {
  const clock = new PlaybackClock();
  assert.equal(clock.seek(t0 + 30_000, range), t0 + 30_000);
  assert.equal(clock.isReplaying, true);
  assert.equal(clock.seek(t0 - 999_999, range), t0, 'clamped to the oldest frame');
  assert.equal(clock.seek(t0 + 999_999, range), t0 + 60_000, 'clamped to the newest');
});

test('seekFraction maps a slider position onto recorded time', () => {
  const clock = new PlaybackClock();
  assert.equal(clock.seekFraction(0, range), t0);
  assert.equal(clock.seekFraction(0.5, range), t0 + 30_000);
  assert.equal(clock.seekFraction(1, range), t0 + 60_000);
  assert.equal(clock.seekFraction(-5, range), t0, 'out-of-band fractions clamp');
  assert.equal(clock.seekFraction(5, range), t0 + 60_000);
});

test('fraction round-trips a seek', () => {
  const clock = new PlaybackClock();
  clock.seekFraction(0.25, range);
  assert.ok(Math.abs(clock.fraction(range) - 0.25) < 1e-9);
});

test('advance moves the head at the selected rate', () => {
  const clock = new PlaybackClock();
  clock.seek(t0, range);
  clock.play(range);
  clock.advance(1000, range);
  assert.equal(clock.positionMs, t0 + 1000, '1x is real time');
  clock.setRate(4);
  clock.advance(1000, range);
  assert.equal(clock.positionMs, t0 + 5000, '4x covers four seconds of history');
});

test('a paused clock does not advance', () => {
  const clock = new PlaybackClock();
  clock.seek(t0 + 10_000, range);
  clock.advance(5000, range);
  assert.equal(clock.positionMs, t0 + 10_000);
});

test('RETURNS LIVE: running off the end goes back to the present, it does not freeze', () => {
  const clock = new PlaybackClock();
  clock.seek(range.endMs - 500, range);
  clock.play(range);
  const result = clock.advance(5000, range);
  assert.equal(result.returnedLive, true);
  assert.equal(clock.mode, 'live', 'a frozen replay head reads as a stalled live feed');
  assert.equal(clock.playing, false);
  assert.equal(clock.positionMs, null);
});

test('loop mode wraps to the start of the window instead of returning live', () => {
  const clock = new PlaybackClock({ loop: true });
  clock.seek(range.endMs - 1000, range);
  clock.play(range);
  const result = clock.advance(3000, range);
  assert.equal(result.wrapped, true);
  assert.equal(clock.mode, 'replay');
  assert.equal(clock.positionMs, t0 + 2000, 'carries the overshoot past the wrap');
});

test('a head that falls off the back of an evicting window is carried to the new start', () => {
  const clock = new PlaybackClock();
  clock.seek(t0 + 1000, range);
  clock.play(range);
  // History rolled forward five minutes while the head sat near the old start.
  const moved = { startMs: t0 + 300_000, endMs: t0 + 360_000 };
  clock.advance(1000, moved);
  assert.equal(clock.positionMs, moved.startMs + 1000, 'resumes at the oldest surviving frame');
  assert.ok(clock.positionMs >= moved.startMs, 'never sits outside the recorded range');
});

test('play from live starts at the oldest frame rather than doing nothing', () => {
  const clock = new PlaybackClock();
  clock.play(range);
  assert.equal(clock.mode, 'replay');
  assert.equal(clock.positionMs, t0, 'play from the present has nowhere forward to go');
  assert.equal(clock.playing, true);
});

test('goLive clears replay and stops playback', () => {
  const clock = new PlaybackClock();
  clock.seek(t0 + 10_000, range);
  clock.play(range);
  clock.goLive();
  assert.equal(clock.mode, 'live');
  assert.equal(clock.playing, false);
  assert.equal(clock.positionMs, null);
});

test('togglePlay alternates without leaving replay', () => {
  const clock = new PlaybackClock();
  clock.seek(t0 + 5000, range);
  clock.togglePlay(range);
  assert.equal(clock.playing, true);
  clock.togglePlay(range);
  assert.equal(clock.playing, false);
  assert.equal(clock.mode, 'replay', 'pause is not a return to live');
});

test('step nudges by whole seconds and pauses', () => {
  const clock = new PlaybackClock();
  clock.seek(t0 + 30_000, range);
  clock.play(range);
  clock.step(-10, range);
  assert.equal(clock.positionMs, t0 + 20_000);
  assert.equal(clock.playing, false, 'stepping is a deliberate, stopped action');
  clock.step(5, range);
  assert.equal(clock.positionMs, t0 + 25_000);
});

test('stepping back from live enters replay at the newest frame', () => {
  const clock = new PlaybackClock();
  clock.step(-10, range);
  assert.equal(clock.mode, 'replay');
  assert.equal(clock.positionMs, range.endMs - 10_000);
});

test('rates snap to the supported set', () => {
  assert.equal(normalizeRate(1), 1);
  assert.equal(normalizeRate(3), 2, 'nearest supported, ties low');
  assert.equal(normalizeRate(100), 8);
  assert.equal(normalizeRate(0), 0.25);
  assert.equal(normalizeRate('nonsense'), 1);
  for (const rate of PLAYBACK_RATES) assert.equal(normalizeRate(rate), rate);
});

test('every transport entry point is inert without a range', () => {
  const clock = new PlaybackClock();
  clock.play(null);
  assert.equal(clock.mode, 'live', 'nothing recorded means nothing to play');
  assert.equal(clock.seek(t0, null), null);
  assert.equal(clock.step(-10, null), null);
  assert.deepEqual(clock.advance(1000, null), { position: null, wrapped: false, returnedLive: false });
});

test('snapshot reports how far behind the present the head is', () => {
  const clock = new PlaybackClock();
  assert.equal(clock.snapshot(range).behindSec, 0, 'live is not behind anything');
  clock.seek(range.endMs - 42_000, range);
  const snap = clock.snapshot(range);
  assert.equal(snap.mode, 'replay');
  assert.equal(snap.behindSec, 42);
});
