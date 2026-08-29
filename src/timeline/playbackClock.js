/**
 * @module timeline/playbackClock
 * @description Transport state for the timeline scrubber.
 *
 * Pure state machine — no timers, no DOM, no Cesium. The host advances it with
 * a wall-clock delta each frame and the clock decides where in the buffer the
 * scene should be drawn.
 *
 * Two modes, and the distinction is load-bearing for honesty:
 *
 *  - **LIVE** — the scene shows the present, exactly as the app always has.
 *    The scrubber is a readout, not a source.
 *  - **REPLAY** — the scene is reconstructed from the buffer at `positionMs`,
 *    and the app is expected to say so on screen. Replay is never entered
 *    implicitly; only an explicit seek or a play from a seek gets you here.
 *
 * Running off the end of the buffer returns to LIVE rather than freezing on
 * the newest frame, because a frozen replay head is indistinguishable from a
 * stalled live feed — precisely the confusion this project spends so much
 * effort avoiding elsewhere.
 */

/** Selectable playback rates. */
export const PLAYBACK_RATES = Object.freeze([0.25, 0.5, 1, 2, 4, 8]);

/** Clamp a rate to the supported set (nearest, ties low). */
export function normalizeRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return 1;
  let best = PLAYBACK_RATES[0];
  let bestDelta = Infinity;
  for (const candidate of PLAYBACK_RATES) {
    const delta = Math.abs(candidate - value);
    if (delta < bestDelta - 1e-9) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

export class PlaybackClock {
  /**
   * @param {object} [options]
   * @param {number} [options.rate] Initial playback rate.
   * @param {boolean} [options.loop] Loop the window instead of returning live.
   */
  constructor({ rate = 1, loop = false } = {}) {
    this.mode = 'live';
    this.playing = false;
    this.rate = normalizeRate(rate);
    this.loop = Boolean(loop);
    this.positionMs = null;
  }

  /** True while the scene should be reconstructed from the buffer. */
  get isReplaying() {
    return this.mode === 'replay';
  }

  /**
   * Jump to a point in the buffer, entering replay.
   * @param {number} t Target time (epoch ms).
   * @param {{startMs:number, endMs:number}|null} range Buffer extent.
   * @returns {number|null} The position actually taken.
   */
  seek(t, range) {
    if (!range || !Number.isFinite(t)) return this.positionMs;
    this.mode = 'replay';
    this.positionMs = Math.min(range.endMs, Math.max(range.startMs, t));
    return this.positionMs;
  }

  /**
   * Seek by fraction of the buffer window — what a range input produces.
   * @param {number} fraction 0…1 across the recorded extent.
   * @param {{startMs:number, endMs:number}|null} range Buffer extent.
   * @returns {number|null} The position actually taken.
   */
  seekFraction(fraction, range) {
    if (!range) return this.positionMs;
    const f = Math.min(1, Math.max(0, Number(fraction) || 0));
    return this.seek(range.startMs + (range.endMs - range.startMs) * f, range);
  }

  /** Where the head sits as a 0…1 fraction; 1 while live. */
  fraction(range) {
    if (!range || range.endMs === range.startMs) return 1;
    if (this.mode === 'live' || this.positionMs === null) return 1;
    return Math.min(1, Math.max(0,
      (this.positionMs - range.startMs) / (range.endMs - range.startMs)));
  }

  /** Return to the present. Playback stops; live is not a played state. */
  goLive() {
    this.mode = 'live';
    this.playing = false;
    this.positionMs = null;
  }

  /**
   * Start playing. From LIVE with no position, playback starts at the oldest
   * retained frame — "play" from the present has nowhere forward to go, and
   * silently doing nothing would read as a broken button.
   * @param {{startMs:number, endMs:number}|null} range Buffer extent.
   */
  play(range) {
    if (!range) return;
    if (this.mode === 'live' || this.positionMs === null) {
      this.mode = 'replay';
      this.positionMs = range.startMs;
    }
    this.playing = true;
  }

  /** Pause without leaving replay. */
  pause() {
    this.playing = false;
  }

  /** Toggle play/pause. */
  togglePlay(range) {
    if (this.playing) this.pause();
    else this.play(range);
  }

  /** Set the playback rate, snapped to the supported set. */
  setRate(rate) {
    this.rate = normalizeRate(rate);
    return this.rate;
  }

  /** Step by whole seconds of recorded time, pausing playback. */
  step(seconds, range) {
    if (!range) return this.positionMs;
    const from = this.mode === 'live' || this.positionMs === null ? range.endMs : this.positionMs;
    this.playing = false;
    return this.seek(from + seconds * 1000, range);
  }

  /**
   * Advance the head by a wall-clock delta.
   *
   * @param {number} deltaMs Elapsed wall-clock time.
   * @param {{startMs:number, endMs:number}|null} range Buffer extent.
   * @returns {{position:number|null, wrapped:boolean, returnedLive:boolean}}
   */
  advance(deltaMs, range) {
    const result = { position: this.positionMs, wrapped: false, returnedLive: false };
    if (!this.playing || this.mode !== 'replay' || !range || !Number.isFinite(deltaMs)) return result;

    // The buffer's oldest frame moves forward as history is evicted. A paused
    // or slow head can fall off the back of the window; rather than sampling
    // outside the range (which the buffer refuses anyway) it is carried to the
    // new start, which is the oldest thing that still exists.
    let next = Math.max(this.positionMs ?? range.startMs, range.startMs) + deltaMs * this.rate;

    if (next >= range.endMs) {
      if (this.loop) {
        const span = range.endMs - range.startMs;
        next = span > 0 ? range.startMs + ((next - range.startMs) % span) : range.startMs;
        this.positionMs = next;
        result.wrapped = true;
      } else {
        this.goLive();
        result.returnedLive = true;
        result.position = null;
        return result;
      }
    } else {
      this.positionMs = next;
    }
    result.position = this.positionMs;
    return result;
  }

  /** Serializable transport state, for the UI to render from. */
  snapshot(range) {
    return {
      mode: this.mode,
      playing: this.playing,
      rate: this.rate,
      loop: this.loop,
      positionMs: this.positionMs,
      fraction: this.fraction(range),
      // Seconds behind the newest observation; 0 while live.
      behindSec: this.mode === 'replay' && range && this.positionMs !== null
        ? Math.max(0, Math.round((range.endMs - this.positionMs) / 1000))
        : 0,
    };
  }
}

export default PlaybackClock;
