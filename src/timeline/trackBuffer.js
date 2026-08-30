/**
 * @module timeline/trackBuffer
 * @description Rolling in-memory buffer of observed live-entity positions.
 *
 * This is the storage half of the timeline scrubber. It holds frames the
 * client ALREADY fetched for the live layers — no extra upstream request is
 * ever made on its behalf, which is what keeps rewind free at the provider.
 *
 * Three honesty rules are structural here, not cosmetic:
 *
 *  1. **The buffer never invents a past.** `sampleAt()` outside the recorded
 *     range returns `null`, not a clamped edge frame. If you did not observe
 *     it, it is not in here.
 *  2. **A gap stays a gap.** Interpolation between two frames is refused once
 *     they are further apart than `maxInterpolationGapMs` (the layer stopped
 *     reporting, the tab slept, the feed dropped). Sliding an aircraft
 *     smoothly across a six-minute hole would be a drawn assertion nobody
 *     observed.
 *  3. **Per-source coverage is separate from buffer extent.** A layer switched
 *     on ten minutes ago has ten minutes of past, even when the buffer spans
 *     forty-five. `coverage()` reports each source's own observed span so the
 *     UI can say so.
 *
 * Pure module: no Cesium, no DOM, no clock of its own. Every entry point takes
 * its time explicitly, which is what makes the whole thing unit-testable.
 */

/** Default retained window (ms) — 45 minutes of observed history. */
export const DEFAULT_WINDOW_MS = 45 * 60 * 1000;
/** Default per-frame record ceiling, applied per source. */
export const DEFAULT_MAX_RECORDS_PER_SOURCE = 1500;
/** Default frame ceiling — a hard memory backstop independent of the window. */
export const DEFAULT_MAX_FRAMES = 900;
/**
 * Default ceiling on total retained samples across every frame.
 *
 * This is the real memory guard, and it is deliberately expressed in samples
 * rather than in frames or minutes: neither of those bounds anything on their
 * own. A parked camera over open ocean retains a handful of vessels per frame;
 * the same window over Europe at rush hour retains thousands of aircraft. Only
 * a total keeps the worst case bounded, so the buffer trades history depth for
 * a fixed footprint (~25 MB at this figure) instead of trading the tab.
 */
export const DEFAULT_MAX_TOTAL_SAMPLES = 250_000;
/**
 * Default largest gap (ms) across which two frames may be interpolated.
 * Sized a little over twice the 10 s record cadence: an ordinary missed tick
 * still glides, a genuine feed outage does not.
 */
export const DEFAULT_MAX_INTERPOLATION_GAP_MS = 25 * 1000;

const FINITE = (value) => (Number.isFinite(value) ? value : null);

/**
 * Normalize one layer-supplied analyst record into a compact buffer sample.
 * Records arrive from `getAnalystRecords()`, whose shape differs per layer
 * (aircraft carry `altitudeM`/`heading`, vessels carry `courseDeg`, fires and
 * quakes carry neither), so the reconciliation lives here rather than being
 * pushed onto every layer.
 *
 * @param {object} record Layer analyst record.
 * @returns {object|null} Buffer sample, or null when it has no usable position.
 */
export function toSample(record) {
  if (!record) return null;
  const lon = FINITE(Number(record.lon));
  const lat = FINITE(Number(record.lat));
  if (lon === null || lat === null) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  const id = String(
    record.icao24 ?? record.mmsi ?? record.id ?? `${lon.toFixed(4)},${lat.toFixed(4)}`,
  );
  const heading = FINITE(Number(record.heading ?? record.courseDeg));
  const sample = {
    id,
    lon,
    lat,
    alt: FINITE(Number(record.altitudeM)) ?? 0,
    heading: heading === null ? null : ((heading % 360) + 360) % 360,
    label: String(record.id ?? id),
  };
  if (record.military === true) sample.military = true;
  return sample;
}

/** Shortest-arc interpolation between two longitudes, in degrees. */
export function lerpLongitude(a, b, f) {
  let delta = b - a;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  const result = a + delta * f;
  if (result > 180) return result - 360;
  if (result < -180) return result + 360;
  return result;
}

/** Shortest-arc interpolation between two compass headings, in degrees. */
export function lerpHeading(a, b, f) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  let delta = b - a;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  return ((a + delta * f) % 360 + 360) % 360;
}

/**
 * Rolling ring buffer of observed frames, keyed by source (layer) id.
 */
export class TrackBuffer {
  /**
   * @param {object} [options]
   * @param {number} [options.windowMs] Retained span of history.
   * @param {number} [options.maxFrames] Hard frame ceiling.
   * @param {number} [options.maxRecordsPerSource] Per-frame record ceiling.
   * @param {number} [options.maxTotalSamples] Ceiling on retained samples.
   * @param {number} [options.maxInterpolationGapMs] Largest interpolable gap.
   */
  constructor({
    windowMs = DEFAULT_WINDOW_MS,
    maxFrames = DEFAULT_MAX_FRAMES,
    maxRecordsPerSource = DEFAULT_MAX_RECORDS_PER_SOURCE,
    maxTotalSamples = DEFAULT_MAX_TOTAL_SAMPLES,
    maxInterpolationGapMs = DEFAULT_MAX_INTERPOLATION_GAP_MS,
  } = {}) {
    this.windowMs = Math.max(60_000, windowMs);
    this.maxFrames = Math.max(2, maxFrames);
    this.maxRecordsPerSource = Math.max(1, maxRecordsPerSource);
    this.maxTotalSamples = Math.max(100, maxTotalSamples);
    this.maxInterpolationGapMs = Math.max(1000, maxInterpolationGapMs);
    /** @type {Array<{t:number, sources:Object<string,Array<object>>, size:number}>} */
    this._frames = [];
    this._truncatedSources = new Set();
    this._totalSamples = 0;
    /** True once memory pressure — not the window — set the oldest retained frame. */
    this._budgetEvicted = false;
  }

  /** Total retained samples across all frames. */
  get sampleCount() {
    return this._totalSamples;
  }

  /** True when the sample budget, not the time window, is bounding history. */
  get budgetLimited() {
    return this._budgetEvicted;
  }

  /** Number of retained frames. */
  get frameCount() {
    return this._frames.length;
  }

  /**
   * Append one observation frame. Frames must arrive in non-decreasing time
   * order; an out-of-order frame is refused rather than silently reordering
   * history.
   *
   * @param {number} t Observation time (epoch ms).
   * @param {Object<string, Array<object>>} sources Records keyed by layer id.
   * @returns {boolean} True when the frame was stored.
   */
  append(t, sources) {
    if (!Number.isFinite(t) || !sources) return false;
    const last = this._frames[this._frames.length - 1];
    if (last && t < last.t) return false;

    const stored = {};
    let total = 0;
    for (const [sourceId, records] of Object.entries(sources)) {
      if (!Array.isArray(records) || records.length === 0) continue;
      const samples = [];
      for (const record of records) {
        if (samples.length >= this.maxRecordsPerSource) {
          this._truncatedSources.add(sourceId);
          break;
        }
        const sample = toSample(record);
        if (sample) samples.push(sample);
      }
      if (samples.length) {
        stored[sourceId] = samples;
        total += samples.length;
      }
    }
    // An all-empty frame still carries information — it is the difference
    // between "nothing was flying" and "we were not looking" — but recording a
    // run of them while every layer is off would be pure waste. Keep one, so
    // the timeline shows the emptiness, and drop consecutive repeats.
    if (total === 0 && last && Object.keys(last.sources).length === 0) {
      last.t = t;
      return true;
    }
    this._frames.push({ t, sources: stored, size: total });
    this._totalSamples += total;
    this._evict(t);
    return true;
  }

  /** Drop the oldest frame and account for its samples. */
  _dropOldest(count) {
    const removed = this._frames.splice(0, count);
    for (const frame of removed) this._totalSamples -= frame.size;
    if (this._totalSamples < 0) this._totalSamples = 0;
  }

  /**
   * Drop frames outside the retained window, over the frame ceiling, or over
   * the sample budget. The budget runs last and is the only one that records
   * having fired: it is the one bound the operator did not choose, so the UI
   * has to be able to say the window is shorter than they asked for.
   */
  _evict(now) {
    const cutoff = now - this.windowMs;
    let expired = 0;
    while (expired < this._frames.length && this._frames[expired].t < cutoff) expired += 1;
    if (expired > 0) this._dropOldest(expired);
    if (this._frames.length > this.maxFrames) {
      this._dropOldest(this._frames.length - this.maxFrames);
    }
    let budgetDropped = 0;
    // Always leave one frame standing: a single frame over budget is still the
    // only record of now, and an empty buffer would be a worse answer.
    while (this._totalSamples > this.maxTotalSamples && this._frames.length > 1) {
      this._dropOldest(1);
      budgetDropped += 1;
    }
    if (budgetDropped > 0) this._budgetEvicted = true;
  }

  /**
   * Recorded extent.
   * @returns {{startMs:number, endMs:number, frameCount:number, spanMs:number}|null}
   */
  range() {
    if (this._frames.length === 0) return null;
    const startMs = this._frames[0].t;
    const endMs = this._frames[this._frames.length - 1].t;
    return { startMs, endMs, spanMs: endMs - startMs, frameCount: this._frames.length };
  }

  /**
   * Per-source observed coverage. A source that was enabled late, or switched
   * off midway, reports its own first/last observation rather than the
   * buffer's extent.
   * @returns {Array<{sourceId:string, startMs:number, endMs:number, frames:number, truncated:boolean}>}
   */
  coverage() {
    const byId = new Map();
    for (const frame of this._frames) {
      for (const sourceId of Object.keys(frame.sources)) {
        const existing = byId.get(sourceId);
        if (existing) {
          existing.endMs = frame.t;
          existing.frames += 1;
        } else {
          byId.set(sourceId, {
            sourceId,
            startMs: frame.t,
            endMs: frame.t,
            frames: 1,
            truncated: this._truncatedSources.has(sourceId),
          });
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  }

  /** Index of the last frame at or before `t`, or -1. */
  _floorIndex(t) {
    let low = 0;
    let high = this._frames.length - 1;
    let result = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this._frames[mid].t <= t) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  /**
   * Reconstruct the observed scene at time `t`.
   *
   * Returns `null` outside the recorded range — the buffer does not clamp,
   * because a clamped edge frame would present the oldest thing it happens to
   * hold as though it were the state at a time nobody watched.
   *
   * The returned `mode` distinguishes the three cases the UI must not blur:
   *   - `observed`   — the head sits exactly on a recorded frame. Best case.
   *   - `interpolated` — between two frames, inside the gap ceiling.
   *   - `held`       — a hole too wide to interpolate, or no forward fix at
   *                    all. The positions are the last ones actually seen.
   *
   * @param {number} t Epoch ms.
   * @param {object} [options]
   * @param {Array<string>} [options.sourceIds] Restrict to these sources.
   * @returns {{t:number, mode:'observed'|'interpolated'|'held', interpolated:boolean, gapMs:number, sources:Object<string,Array<object>>}|null}
   */
  sampleAt(t, { sourceIds = null } = {}) {
    const range = this.range();
    if (!range || !Number.isFinite(t)) return null;
    if (t < range.startMs || t > range.endMs) return null;

    const index = this._floorIndex(t);
    if (index < 0) return null;
    const before = this._frames[index];
    const after = this._frames[index + 1] || null;
    const wanted = sourceIds ? new Set(sourceIds) : null;

    const gapMs = after ? after.t - before.t : 0;
    const canInterpolate = Boolean(after)
      && gapMs > 0
      && gapMs <= this.maxInterpolationGapMs
      && t > before.t;
    const f = canInterpolate ? (t - before.t) / gapMs : 0;

    const sources = {};
    for (const [sourceId, samples] of Object.entries(before.sources)) {
      if (wanted && !wanted.has(sourceId)) continue;
      if (!canInterpolate) {
        sources[sourceId] = samples.map((sample) => ({ ...sample, interpolated: false }));
        continue;
      }
      const nextById = new Map();
      for (const sample of after.sources[sourceId] || []) nextById.set(sample.id, sample);
      sources[sourceId] = samples.map((sample) => {
        const next = nextById.get(sample.id);
        if (!next) return { ...sample, interpolated: false };
        return {
          ...sample,
          lon: lerpLongitude(sample.lon, next.lon, f),
          lat: sample.lat + (next.lat - sample.lat) * f,
          alt: sample.alt + (next.alt - sample.alt) * f,
          heading: lerpHeading(sample.heading, next.heading, f),
          interpolated: true,
        };
      });
    }
    return {
      t,
      // Landing exactly on a recorded frame is the strongest state the buffer
      // has, and must not be reported as a held fix — that would read as a
      // stalled contact when it is in fact a direct observation.
      mode: t === before.t ? 'observed' : (canInterpolate ? 'interpolated' : 'held'),
      interpolated: canInterpolate,
      // A frame's own forward gap, reported so the UI can mark a hole the
      // scrubber is sitting inside rather than presenting it as continuous.
      gapMs,
      sources,
    };
  }

  /**
   * Positions of one entity across the whole buffer — the trail behind a
   * contact while scrubbing.
   * @param {string} sourceId Layer id.
   * @param {string} entityId Entity id within that layer.
   * @param {number} [untilMs] Stop at this time (defaults to the buffer end).
   * @returns {Array<{t:number, lon:number, lat:number, alt:number}>}
   */
  trackOf(sourceId, entityId, untilMs = Infinity) {
    const points = [];
    for (const frame of this._frames) {
      if (frame.t > untilMs) break;
      const samples = frame.sources[sourceId];
      if (!samples) continue;
      const hit = samples.find((sample) => sample.id === entityId);
      if (hit) points.push({ t: frame.t, lon: hit.lon, lat: hit.lat, alt: hit.alt });
    }
    return points;
  }

  /** Discard all history. */
  clear() {
    this._frames.length = 0;
    this._truncatedSources.clear();
    this._totalSamples = 0;
    this._budgetEvicted = false;
  }

  /**
   * JSON-safe export of the retained window.
   * @param {object} [meta] Extra provenance fields to record alongside.
   * @returns {object}
   */
  toJSON(meta = {}) {
    const range = this.range();
    return {
      format: 'gods-eye-view/timeline',
      version: 1,
      exportedAt: new Date().toISOString(),
      // Named so a reader of the file cannot mistake it for an archive query.
      provenance: 'Client-side buffer of positions observed by this browser session. Not an authoritative archive; gaps are real.',
      windowMs: this.windowMs,
      budgetLimited: this._budgetEvicted,
      samples: this._totalSamples,
      range: range
        ? { startIso: new Date(range.startMs).toISOString(), endIso: new Date(range.endMs).toISOString(), frames: range.frameCount }
        : null,
      coverage: this.coverage().map((entry) => ({
        ...entry,
        startIso: new Date(entry.startMs).toISOString(),
        endIso: new Date(entry.endMs).toISOString(),
      })),
      ...meta,
      frames: this._frames.map((frame) => ({ t: frame.t, sources: frame.sources })),
    };
  }
}

export default TrackBuffer;
