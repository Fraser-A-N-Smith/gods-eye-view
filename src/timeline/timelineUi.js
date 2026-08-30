/**
 * @module timeline/timelineUi
 * @description The scrub bar: transport controls, coverage readout, export.
 *
 * The presentation rules live in exported pure functions at the top of the
 * file; the class below is a thin DOM binder over them. The split exists
 * because the interesting decisions here are all about *what the bar is
 * allowed to claim* — that a window is 45 minutes when memory pressure cut it
 * to 12, or that a layer has history it was switched off for — and those
 * decisions are worth pinning in tests without a browser.
 */

import { SOURCE_LABELS } from './timelineRecorder.js';

/** Zulu clock label for a buffer position. */
export function formatClock(ms) {
  if (!Number.isFinite(ms)) return '--:--:--Z';
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

/** Compact elapsed label — "8s", "4m 20s", "1h 02m". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The bar's primary status line.
 *
 * LIVE says how much history is banked behind you; REPLAY says how far back
 * you are and how the drawn frame was arrived at. Those three states are not
 * decoration: sitting on a recorded frame, gliding between two, and holding a
 * contact's last known fix across a hole are different claims about the world,
 * and only the first is a direct observation.
 *
 * @param {object} input
 * @param {object} input.transport PlaybackClock snapshot.
 * @param {{startMs:number, endMs:number, spanMs:number}|null} input.range Buffer extent.
 * @param {'observed'|'interpolated'|'held'} [input.frameMode] How the frame was derived.
 * @param {number} [input.count] Entities in the drawn frame.
 * @returns {{mode:string, clock:string, detail:string}}
 */
export const FRAME_MODE_LABELS = Object.freeze({
  observed: 'OBSERVED FIX',
  interpolated: 'INTERPOLATED',
  held: 'HELD LAST FIX',
});

export function statusLine({ transport, range, frameMode = 'held', count = 0 }) {
  if (!range) {
    return { mode: 'LIVE', clock: formatClock(Date.now()), detail: 'NO HISTORY BUFFERED YET' };
  }
  if (transport.mode !== 'replay') {
    return {
      mode: 'LIVE',
      clock: formatClock(range.endMs),
      detail: `${formatDuration(range.spanMs)} BUFFERED`,
    };
  }
  const parts = [`-${formatDuration(range.endMs - transport.positionMs)}`];
  parts.push(FRAME_MODE_LABELS[frameMode] || FRAME_MODE_LABELS.held);
  parts.push(`${count} CONTACTS`);
  return { mode: 'REPLAY', clock: formatClock(transport.positionMs), detail: parts.join(' · ') };
}

/**
 * Per-source coverage chips.
 *
 * Each chip reports that source's OWN observed span, which is routinely
 * shorter than the buffer's — a layer switched on two minutes ago has two
 * minutes of past, and saying otherwise would invite scrubbing back to a time
 * that was never recorded for it.
 *
 * @param {Array<object>} coverage TrackBuffer.coverage() output.
 * @param {{startMs:number, endMs:number}|null} range Buffer extent.
 * @returns {Array<{sourceId:string, label:string, text:string, partial:boolean, truncated:boolean}>}
 */
export function coverageChips(coverage, range) {
  if (!Array.isArray(coverage) || !range) return [];
  return coverage.map((entry) => {
    const span = entry.endMs - entry.startMs;
    // "Partial" means this source does not cover the whole scrubbable window,
    // with a second of slack so a single missed tick is not flagged.
    const partial = entry.startMs > range.startMs + 1000 || entry.endMs < range.endMs - 1000;
    return {
      sourceId: entry.sourceId,
      label: SOURCE_LABELS[entry.sourceId] || entry.sourceId.toUpperCase(),
      text: formatDuration(span),
      partial,
      truncated: Boolean(entry.truncated),
    };
  });
}

/**
 * The one-line caveat under the bar. Returns null when there is nothing to
 * disclose — an empty caveat line is better than a permanent boilerplate one
 * nobody reads.
 *
 * @param {object} input
 * @param {object} input.buffer TrackBuffer (for budget/limit state).
 * @param {Array<object>} input.chips coverageChips() output.
 * @returns {string|null}
 */
export function caveatLine({ buffer, chips }) {
  const notes = [];
  if (buffer?.budgetLimited) {
    notes.push('window shortened to stay inside the memory budget');
  }
  const truncated = chips.filter((chip) => chip.truncated).map((chip) => chip.label);
  if (truncated.length) {
    notes.push(`${truncated.join(', ')} capped per frame — not every contact is recorded`);
  }
  const partial = chips.filter((chip) => chip.partial && !chip.truncated).map((chip) => chip.label);
  if (partial.length) {
    notes.push(`${partial.join(', ')} cover only part of this window`);
  }
  return notes.length ? notes.join(' · ').toUpperCase() : null;
}

/** Suggested filename for a timeline export. */
export function exportFilename(nowMs = Date.now()) {
  const iso = new Date(nowMs).toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
  return `gev-timeline-${iso}.json`;
}

/**
 * DOM binder for the scrub bar. Every element is optional: a page that has not
 * been updated with the markup simply gets an inert controller rather than a
 * boot failure.
 */
export class TimelineUi {
  /**
   * @param {object} options
   * @param {Document} [options.doc] Document to bind against.
   * @param {object} options.handlers Transport callbacks.
   */
  constructor({ doc = document, handlers = {} } = {}) {
    this.doc = doc;
    this.handlers = handlers;
    this.root = doc.getElementById('timeline-bar');
    this.el = {
      mode: doc.getElementById('timeline-mode'),
      clock: doc.getElementById('timeline-clock'),
      detail: doc.getElementById('timeline-detail'),
      scrub: doc.getElementById('timeline-scrub'),
      play: doc.getElementById('timeline-play'),
      stepBack: doc.getElementById('timeline-step-back'),
      stepForward: doc.getElementById('timeline-step-forward'),
      live: doc.getElementById('timeline-live'),
      rate: doc.getElementById('timeline-rate'),
      loop: doc.getElementById('timeline-loop'),
      exportBtn: doc.getElementById('timeline-export'),
      coverage: doc.getElementById('timeline-coverage'),
      caveat: doc.getElementById('timeline-caveat'),
    };
    this._scrubbing = false;
    this._bind();
  }

  /** True when the markup is present and the bar can be driven. */
  get available() {
    return Boolean(this.root && this.el.scrub);
  }

  _bind() {
    if (!this.available) return;
    const { scrub, play, stepBack, stepForward, live, rate, loop, exportBtn } = this.el;

    // Dragging must not fight the playback loop for the slider position, so
    // the loop stops writing to it between pointerdown and pointerup.
    scrub.addEventListener('pointerdown', () => { this._scrubbing = true; });
    const endScrub = () => { this._scrubbing = false; };
    scrub.addEventListener('pointerup', endScrub);
    scrub.addEventListener('pointercancel', endScrub);
    scrub.addEventListener('blur', endScrub);
    scrub.addEventListener('input', () => {
      const fraction = Number(scrub.value) / Number(scrub.max || 1000);
      this.handlers.onSeekFraction?.(fraction);
    });
    scrub.addEventListener('change', endScrub);

    play?.addEventListener('click', () => this.handlers.onTogglePlay?.());
    stepBack?.addEventListener('click', () => this.handlers.onStep?.(-10));
    stepForward?.addEventListener('click', () => this.handlers.onStep?.(10));
    live?.addEventListener('click', () => this.handlers.onGoLive?.());
    rate?.addEventListener('change', () => this.handlers.onRate?.(Number(rate.value)));
    loop?.addEventListener('click', () => this.handlers.onToggleLoop?.());
    exportBtn?.addEventListener('click', () => this.handlers.onExport?.());
  }

  /** Show or hide the whole bar. */
  setVisible(visible) {
    if (this.root) this.root.hidden = !visible;
  }

  /**
   * Repaint from current state.
   * @param {object} view See statusLine/coverageChips inputs.
   */
  render(view) {
    if (!this.available) return;
    const { transport, range, buffer, coverage = [], frameMode = 'held', count = 0 } = view;
    const status = statusLine({ transport, range, frameMode, count });
    const chips = coverageChips(coverage, range);

    if (this.el.mode) {
      this.el.mode.textContent = status.mode;
      this.el.mode.dataset.mode = status.mode.toLowerCase();
    }
    if (this.el.clock) this.el.clock.textContent = status.clock;
    if (this.el.detail) this.el.detail.textContent = status.detail;

    if (!this._scrubbing) {
      const max = Number(this.el.scrub.max || 1000);
      this.el.scrub.value = String(Math.round(transport.fraction * max));
    }
    this.el.scrub.disabled = !range;

    if (this.el.play) {
      this.el.play.textContent = transport.playing ? '❚❚' : '▶';
      this.el.play.setAttribute('aria-label', transport.playing ? 'Pause replay' : 'Play replay');
      this.el.play.setAttribute('aria-pressed', String(transport.playing));
    }
    if (this.el.live) {
      this.el.live.classList.toggle('active', transport.mode === 'live');
      this.el.live.setAttribute('aria-pressed', String(transport.mode === 'live'));
    }
    if (this.el.loop) {
      this.el.loop.classList.toggle('active', Boolean(transport.loop));
      this.el.loop.setAttribute('aria-pressed', String(Boolean(transport.loop)));
    }
    if (this.el.rate && Number(this.el.rate.value) !== transport.rate) {
      this.el.rate.value = String(transport.rate);
    }
    if (this.root) this.root.dataset.mode = transport.mode;

    if (this.el.coverage) {
      this.el.coverage.textContent = '';
      for (const chip of chips) {
        const node = this.doc.createElement('span');
        node.className = 'timeline-coverage-chip';
        if (chip.partial) node.classList.add('partial');
        node.dataset.source = chip.sourceId;
        node.textContent = `${chip.label} ${chip.text}`;
        if (chip.partial) node.title = 'This layer covers only part of the buffered window';
        this.el.coverage.appendChild(node);
      }
    }
    if (this.el.caveat) {
      const caveat = caveatLine({ buffer, chips });
      this.el.caveat.textContent = caveat || '';
      this.el.caveat.hidden = !caveat;
    }
  }
}

export default TimelineUi;
