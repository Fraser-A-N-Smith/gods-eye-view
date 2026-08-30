/**
 * @module timeline/timelineRecorder
 * @description Feeds the rolling track buffer from the live data layers.
 *
 * The recorder is deliberately parasitic: it reads each layer's existing
 * `getAnalystRecords()` snapshot — the same seam the voice analyst queries —
 * and never issues a request of its own. Rewind therefore costs nothing at the
 * provider, which is the whole reason the feature can ship keyless.
 *
 * It records a layer only while that layer is enabled. Switching a layer off
 * stops its history at that moment rather than back-filling or interpolating
 * across the absence, so the gap the operator created stays visible in the
 * scrubber.
 */

import { TrackBuffer } from './trackBuffer.js';

/**
 * Layers that expose an analyst-record snapshot worth replaying.
 * Every id here must implement `getAnalystRecords()`; one that stops doing so
 * degrades to "not recorded" rather than throwing.
 */
export const RECORDED_SOURCE_IDS = Object.freeze([
  'flights',
  'military',
  'ais-live-vessels',
  'earthquakes',
  'local-firms',
]);

/** Human labels for the recorded sources, used by the scrubber's coverage row. */
export const SOURCE_LABELS = Object.freeze({
  flights: 'FLIGHTS',
  military: 'MILITARY',
  'ais-live-vessels': 'VESSELS',
  earthquakes: 'QUAKES',
  'local-firms': 'FIRES',
});

/** Default record cadence (ms). Slower than any live feed polls, on purpose. */
export const DEFAULT_RECORD_INTERVAL_MS = 15_000;
/** Records pulled per source per tick. */
export const DEFAULT_PER_SOURCE_LIMIT = 900;

/**
 * Read one frame's worth of records from the enabled layers.
 *
 * Pure with respect to the buffer — exported separately so the gathering rules
 * (enabled-only, missing-seam tolerance, per-source limit) can be tested
 * without a timer.
 *
 * @param {object} dataManager Live DataLayerManager (or a test double).
 * @param {object} [options]
 * @param {Array<string>} [options.sourceIds] Sources to consider.
 * @param {number} [options.limit] Per-source record ceiling.
 * @returns {Object<string, Array<object>>} Records keyed by layer id.
 */
export function gatherFrame(dataManager, { sourceIds = RECORDED_SOURCE_IDS, limit = DEFAULT_PER_SOURCE_LIMIT } = {}) {
  const frame = {};
  if (!dataManager?.layers) return frame;
  for (const sourceId of sourceIds) {
    const entry = dataManager.layers.get(sourceId);
    if (!entry) continue;
    // A disabled layer contributes nothing. Its history simply stops here.
    if (typeof dataManager.isEnabled === 'function' && !dataManager.isEnabled(sourceId)) continue;
    const module = entry.module;
    if (typeof module?.getAnalystRecords !== 'function') continue;
    try {
      const records = module.getAnalystRecords(limit);
      if (Array.isArray(records) && records.length) frame[sourceId] = records;
    } catch (error) {
      // One layer misbehaving must not stop the whole recording.
      console.warn(`[Timeline] ${sourceId} record snapshot failed:`, error);
    }
  }
  return frame;
}

/**
 * Periodic recorder driving a TrackBuffer.
 */
export class TimelineRecorder {
  /**
   * @param {object} options
   * @param {object} options.dataManager Live DataLayerManager.
   * @param {TrackBuffer} [options.buffer] Buffer to fill.
   * @param {number} [options.intervalMs] Record cadence.
   * @param {Array<string>} [options.sourceIds] Sources to record.
   * @param {number} [options.perSourceLimit] Records per source per tick.
   * @param {() => number} [options.now] Clock seam.
   * @param {Function} [options.setIntervalFn] Timer seam.
   * @param {Function} [options.clearIntervalFn] Timer seam.
   */
  constructor({
    dataManager,
    buffer = new TrackBuffer(),
    intervalMs = DEFAULT_RECORD_INTERVAL_MS,
    sourceIds = RECORDED_SOURCE_IDS,
    perSourceLimit = DEFAULT_PER_SOURCE_LIMIT,
    now = () => Date.now(),
    setIntervalFn = null,
    clearIntervalFn = null,
  } = {}) {
    this.dataManager = dataManager;
    this.buffer = buffer;
    this.intervalMs = Math.max(1000, intervalMs);
    this.sourceIds = [...sourceIds];
    this.perSourceLimit = perSourceLimit;
    this._now = now;
    this._setInterval = setIntervalFn || ((fn, ms) => setInterval(fn, ms));
    this._clearInterval = clearIntervalFn || ((handle) => clearInterval(handle));
    this._handle = null;
    this._listeners = new Set();
    this.tickCount = 0;
  }

  /** True while the recorder is running. */
  get running() {
    return this._handle !== null;
  }

  /**
   * Capture one frame immediately.
   * @returns {boolean} True when a frame was stored.
   */
  tick() {
    const frame = gatherFrame(this.dataManager, {
      sourceIds: this.sourceIds,
      limit: this.perSourceLimit,
    });
    const stored = this.buffer.append(this._now(), frame);
    this.tickCount += 1;
    if (stored) this._emit();
    return stored;
  }

  /** Begin recording. Captures one frame up front so history starts at once. */
  start() {
    if (this._handle) return;
    this.tick();
    this._handle = this._setInterval(() => this.tick(), this.intervalMs);
  }

  /** Stop recording. The buffer keeps whatever it already holds. */
  stop() {
    if (!this._handle) return;
    this._clearInterval(this._handle);
    this._handle = null;
  }

  /** Subscribe to buffer growth. @returns {() => void} Unsubscribe. */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit() {
    for (const listener of this._listeners) {
      try {
        listener(this.buffer);
      } catch (error) {
        console.warn('[Timeline] recorder listener error:', error);
      }
    }
  }

  /** Stop and release listeners. */
  destroy() {
    this.stop();
    this._listeners.clear();
  }
}

export default TimelineRecorder;
