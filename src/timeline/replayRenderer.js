/**
 * @module timeline/replayRenderer
 * @description Draws a reconstructed past frame onto the globe.
 *
 * The renderer owns its own primitives and never touches the live layers'
 * collections. That separation is what lets replay be a strictly additive
 * feature: turning the scrubber off leaves the live path byte-for-byte as it
 * was.
 *
 * While replay is on screen the live layers are asked to stand down via the
 * optional `setReplaySuppressed()` hook, so the operator sees one world rather
 * than the present and the past drawn on top of each other. Layers that do not
 * implement the hook keep rendering live — documented, not silently broken.
 *
 * Render-governor contract (see docs/CURRENT-STATE.md): playback is a
 * per-frame visual animation and holds the governor for its duration; a paused
 * seek is a discrete mutation and requests a single frame instead.
 */

import * as Cesium from 'cesium';
import {
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

const GOVERNOR_OWNER = 'timeline-replay';

/** Per-source replay colours. Deliberately close to each layer's live palette. */
export const SOURCE_COLORS = Object.freeze({
  flights: '#38e1ff',
  military: '#ffb020',
  'ais-live-vessels': '#4ade80',
  earthquakes: '#ff5a5a',
  'local-firms': '#ff7a1a',
});

const DEFAULT_COLOR = '#c8d6e5';

/** Point size in pixels by source — moving contacts read larger than events. */
const SOURCE_PIXEL_SIZE = Object.freeze({
  flights: 7,
  military: 8,
  'ais-live-vessels': 6,
  earthquakes: 9,
  'local-firms': 7,
});

/**
 * Resolve a replay sample's render height.
 *
 * Replay deliberately does NOT run samples through the geoid/terrain datum the
 * live layers use (`renderAltitude.js`): those sample the *currently rendered*
 * terrain mesh, which is a property of the camera's present tile set, not of
 * the past. Reusing it would make a replayed position drift as tiles stream.
 * A replay point is drawn at its reported altitude and is marked as a
 * reconstruction on screen instead.
 *
 * @param {object} sample Buffer sample.
 * @returns {number} Height in metres.
 */
export function replayHeight(sample) {
  const alt = Number(sample?.alt);
  if (!Number.isFinite(alt) || alt <= 0) return 12;
  return alt;
}

export class ReplayRenderer {
  /**
   * @param {object} options
   * @param {Cesium.Viewer} options.viewer Live viewer.
   * @param {object} [options.dataManager] Used to reach layer suppression hooks.
   * @param {Array<string>} [options.sourceIds] Sources this renderer owns.
   */
  constructor({ viewer, dataManager = null, sourceIds = [] }) {
    this.viewer = viewer;
    this.dataManager = dataManager;
    this.sourceIds = [...sourceIds];
    this._points = null;
    this._active = false;
    this._holding = false;
    this._suppressed = false;
    this._renderedCount = 0;
  }

  /** Lazily create the primitive collection — nothing is added until first use. */
  _ensureCollection() {
    if (this._points || !this.viewer?.scene) return this._points;
    this._points = this.viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this._points.show = false;
    return this._points;
  }

  /** True while a reconstructed frame is on screen. */
  get active() {
    return this._active;
  }

  /** Number of points in the last drawn frame. */
  get renderedCount() {
    return this._renderedCount;
  }

  /**
   * Ask the live layers to stand down (or resume) so past and present are
   * never drawn simultaneously.
   * @param {boolean} suppressed Whether live rendering should be hidden.
   */
  _setLiveSuppressed(suppressed) {
    if (this._suppressed === suppressed || !this.dataManager?.layers) return;
    this._suppressed = suppressed;
    for (const sourceId of this.sourceIds) {
      const module = this.dataManager.layers.get(sourceId)?.module;
      if (typeof module?.setReplaySuppressed !== 'function') continue;
      try {
        module.setReplaySuppressed(suppressed);
      } catch (error) {
        console.warn(`[Timeline] ${sourceId} replay suppression failed:`, error);
      }
    }
  }

  /**
   * Draw one reconstructed frame.
   * @param {{sources:Object<string,Array<object>>}|null} frame Buffer sample.
   * @param {object} [options]
   * @param {boolean} [options.playing] Whether playback is running.
   */
  render(frame, { playing = false } = {}) {
    const points = this._ensureCollection();
    if (!points) return;

    if (!frame) {
      this.clear();
      return;
    }

    points.removeAll();
    let count = 0;
    for (const [sourceId, samples] of Object.entries(frame.sources || {})) {
      const color = Cesium.Color.fromCssColorString(SOURCE_COLORS[sourceId] || DEFAULT_COLOR);
      const pixelSize = SOURCE_PIXEL_SIZE[sourceId] ?? 6;
      for (const sample of samples) {
        points.add({
          position: Cesium.Cartesian3.fromDegrees(sample.lon, sample.lat, replayHeight(sample)),
          color,
          pixelSize,
          // A held position (no forward fix to interpolate toward) is drawn
          // hollow-ish via a dimmer outline, so a stalled contact is visibly
          // different from one the buffer is actually carrying.
          outlineColor: sample.interpolated ? Cesium.Color.BLACK.withAlpha(0.5) : color.withAlpha(0.25),
          outlineWidth: sample.interpolated ? 1 : 2,
          translucencyByDistance: undefined,
        });
        count += 1;
      }
    }
    this._renderedCount = count;
    points.show = true;
    this._active = true;
    this._setLiveSuppressed(true);
    this._setHold(playing);
    if (!playing) governorRequestRender('timeline-seek');
  }

  /** Hold the render governor only while playback is actually animating. */
  _setHold(shouldHold) {
    if (shouldHold && !this._holding) {
      holdContinuousRender(GOVERNOR_OWNER);
      this._holding = true;
    } else if (!shouldHold && this._holding) {
      releaseContinuousRender(GOVERNOR_OWNER);
      this._holding = false;
    }
  }

  /** Remove the reconstructed frame and hand the globe back to the live layers. */
  clear() {
    if (this._points) {
      this._points.removeAll();
      this._points.show = false;
    }
    this._renderedCount = 0;
    if (this._active) {
      this._active = false;
      this._setLiveSuppressed(false);
      governorRequestRender('timeline-live');
    }
    this._setHold(false);
  }

  /** Tear down primitives and restore live rendering. */
  destroy() {
    this.clear();
    if (this._points && this.viewer?.scene && !this.viewer.isDestroyed?.()) {
      this.viewer.scene.primitives.remove(this._points);
    }
    this._points = null;
  }
}

export default ReplayRenderer;
