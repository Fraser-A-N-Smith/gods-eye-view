/**
 * @module timeline
 * @description Rolling history buffer and scrub bar — rewind the last N
 * minutes of the live globe.
 *
 * ## Why this can exist at all
 *
 * Going back in time over a planet is famously expensive: tiling, serving and
 * scrubbing *what changed* at real resolution is a different class of problem
 * from showing the present. This feature does not attempt that. It records
 * only what this browser session already fetched for the layers you had
 * switched on, keeps it in memory under a fixed budget, and lets you scrub
 * that. Nothing here issues an upstream request, so rewind costs exactly zero
 * at every provider, keyed or not.
 *
 * What that buys is the cheap 90%: "what was that contact doing thirty seconds
 * ago", "play the last ten minutes of the approach", "export the window I just
 * watched". What it explicitly is NOT is an archive — close the tab and the
 * history is gone, and the UI says so rather than implying otherwise.
 *
 * ## Deliberately not shareable
 *
 * A replay position is a pointer into *this* browser's buffer. Serializing it
 * into a share link would hand someone a timestamp their session never
 * observed, so the timeline stays out of the share-link lanes entirely. Camera,
 * style and layers still serialize exactly as before.
 */

import { TrackBuffer, DEFAULT_WINDOW_MS } from './trackBuffer.js';
import { TimelineRecorder, RECORDED_SOURCE_IDS } from './timelineRecorder.js';
import { PlaybackClock } from './playbackClock.js';
import { ReplayRenderer } from './replayRenderer.js';
import { TimelineUi, exportFilename } from './timelineUi.js';

/** Retained window. 30 minutes is the point where the sample budget usually binds first. */
export const TIMELINE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Largest slice of recorded time one rendered frame may advance.
 *
 * Guards against a stall (tab hidden, a blocking tile load) fast-forwarding
 * the head across minutes in a single step. The cost is that on a machine
 * rendering below ~2 fps playback runs slower than the selected rate rather
 * than skipping — the honest trade, since a skipped stretch is history the
 * operator never saw replayed.
 */
export const MAX_FRAME_ADVANCE_MS = 500;

/**
 * Wire the timeline into a running app.
 *
 * @param {object} options
 * @param {import('cesium').Viewer} options.viewer Live viewer.
 * @param {object} options.dataManager Live DataLayerManager.
 * @param {Document} [options.doc] Document to bind the bar against.
 * @returns {object} Controller with `toggle`, `goLive`, `destroy`, and state readers.
 */
export function initTimeline({ viewer, dataManager, doc = document }) {
  const buffer = new TrackBuffer({ windowMs: TIMELINE_WINDOW_MS });
  const recorder = new TimelineRecorder({ dataManager, buffer });
  const clock = new PlaybackClock();
  const renderer = new ReplayRenderer({ viewer, dataManager, sourceIds: RECORDED_SOURCE_IDS });

  let visible = false;
  let lastFrameMs = 0;
  let lastDrawn = null;

  const ui = new TimelineUi({
    doc,
    handlers: {
      onSeekFraction: (fraction) => {
        clock.seekFraction(fraction, buffer.range());
        draw();
      },
      onTogglePlay: () => {
        clock.togglePlay(buffer.range());
        lastFrameMs = 0;
        draw();
      },
      onStep: (seconds) => {
        clock.step(seconds, buffer.range());
        draw();
      },
      onGoLive: () => goLive(),
      onRate: (rate) => {
        clock.setRate(rate);
        paint();
      },
      onToggleLoop: () => {
        clock.loop = !clock.loop;
        paint();
      },
      onExport: () => exportWindow(),
    },
  });

  /** Repaint the bar from current state without touching the scene. */
  function paint() {
    if (!visible) return;
    ui.render({
      transport: clock.snapshot(buffer.range()),
      range: buffer.range(),
      buffer,
      coverage: buffer.coverage(),
      frameMode: lastDrawn?.mode ?? 'held',
      count: renderer.renderedCount,
    });
  }

  /** Reconstruct and draw the scene at the clock's current position. */
  function draw() {
    const range = buffer.range();
    if (!clock.isReplaying || !range) {
      renderer.clear();
      lastDrawn = null;
      paint();
      return;
    }
    const frame = buffer.sampleAt(clock.positionMs, { sourceIds: RECORDED_SOURCE_IDS });
    lastDrawn = frame;
    renderer.render(frame, { playing: clock.playing });
    paint();
  }

  /** Return to the present and hand the globe back to the live layers. */
  function goLive() {
    clock.goLive();
    renderer.clear();
    lastDrawn = null;
    paint();
  }

  /** Advance playback. Driven by the render loop, which the governor holds while playing. */
  function onPreRender() {
    if (!clock.playing || !clock.isReplaying) {
      lastFrameMs = 0;
      return;
    }
    const now = performance.now();
    if (lastFrameMs === 0) {
      lastFrameMs = now;
      return;
    }
    // A long stall (tab hidden, a blocking load) must not fast-forward the
    // head across minutes of history in one step; cap the advance at a frame
    // budget so playback resumes from where it stopped instead of jumping.
    const delta = Math.min(now - lastFrameMs, MAX_FRAME_ADVANCE_MS);
    lastFrameMs = now;
    const result = clock.advance(delta, buffer.range());
    if (result.returnedLive) goLive();
    else draw();
  }

  /** Serialize the retained window to a JSON file the operator can keep. */
  function exportWindow() {
    const payload = buffer.toJSON({
      recordedSources: RECORDED_SOURCE_IDS,
      note: 'Positions this browser observed from public live feeds. Replays are reconstructions, not authoritative tracks.',
    });
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = exportFilename();
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoked on a later turn of the loop so the download has claimed it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch (error) {
      console.warn('[Timeline] export failed:', error);
      return false;
    }
  }

  /** Show or hide the scrub bar. Hiding always returns the scene to live. */
  function setVisible(next) {
    visible = Boolean(next);
    ui.setVisible(visible);
    doc.body.classList.toggle('timeline-open', visible);
    if (!visible) goLive();
    else paint();
  }

  function toggle() {
    setVisible(!visible);
  }

  // Recording runs whether or not the bar is on screen: history you did not
  // record is history you cannot scrub back to, and the operator opens the bar
  // precisely when they want the past that already went by.
  recorder.start();
  const offRecorder = recorder.onChange(() => {
    // While live, a new frame extends the window; while replaying, eviction
    // may have moved the floor under the head. Either way the bar is stale.
    paint();
  });

  const preRenderRemove = viewer?.scene?.preRender
    ? viewer.scene.preRender.addEventListener(onPreRender)
    : null;

  const onKeyDown = (event) => {
    const isFormControl = event.target?.matches?.('select, input, textarea');
    if (isFormControl) return;
    if (event.key?.toLowerCase() === 't') toggle();
  };
  doc.addEventListener('keydown', onKeyDown);

  paint();

  return {
    buffer,
    recorder,
    clock,
    renderer,
    ui,
    toggle,
    setVisible,
    goLive,
    exportWindow,
    get visible() { return visible; },
    /** Diagnostics for QA harnesses and the console. */
    getDiagnostics() {
      const range = buffer.range();
      return {
        frames: buffer.frameCount,
        samples: buffer.sampleCount,
        budgetLimited: buffer.budgetLimited,
        windowMs: buffer.windowMs,
        spanMs: range ? range.spanMs : 0,
        coverage: buffer.coverage(),
        transport: clock.snapshot(range),
        rendered: renderer.renderedCount,
      };
    },
    destroy() {
      doc.removeEventListener('keydown', onKeyDown);
      offRecorder();
      recorder.destroy();
      preRenderRemove?.();
      renderer.destroy();
      doc.body.classList.remove('timeline-open');
    },
  };
}

export { TrackBuffer, TimelineRecorder, PlaybackClock, ReplayRenderer, TimelineUi, DEFAULT_WINDOW_MS };
export default initTimeline;
