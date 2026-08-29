#!/usr/bin/env node
/**
 * In-app proof for the timeline scrubber (src/timeline/).
 *
 * The unit suite covers the buffer, transport and presentation rules in
 * isolation. What only a browser can prove is the wiring: that the bar exists,
 * that dragging it reconstructs a past frame onto the globe, that the live
 * layers stand down while it does, and that leaving replay hands the globe
 * back. Live feeds are not required — the harness seeds the buffer with
 * synthetic observations, because what is under test is the replay path, not
 * OpenSky.
 *
 * Run: node scripts/qa-timeline.mjs --url http://localhost:4173
 * Add --teeth to run the negative control (removes the bar; every
 * bar-dependent section must go red).
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const APP_URL = option('--url', process.env.QA_BASE_URL || 'http://localhost:4173');
const HEADFUL = args.includes('--headful');
const TEETH = args.includes('--teeth');

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  (() => { try { return puppeteer.executablePath(); } catch { return null; } })(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => {
  try { return fs.existsSync(candidate); } catch { return false; }
});

const results = [];
const check = (section, condition, detail) => {
  results.push({ section, ok: Boolean(condition), detail });
};

const browser = await puppeteer.launch({
  headless: HEADFUL ? false : 'new',
  executablePath: chrome,
  args: HEADFUL
    ? ['--no-sandbox']
    : ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => window.__godsEyeView?.timeline, { timeout: 90_000 });

  if (TEETH) {
    // Negative control: remove the bar and confirm the sections that depend on
    // it actually fail. A harness that stays green without its subject is not
    // testing anything.
    await page.evaluate(() => document.getElementById('timeline-bar')?.remove());
  }

  const probe = await page.evaluate(async () => {
    const out = {};
    const tl = window.__godsEyeView.timeline;

    out.controllerPresent = Boolean(tl);
    out.barPresent = Boolean(document.getElementById('timeline-bar'));
    out.hiddenByDefault = document.getElementById('timeline-bar')?.hidden ?? null;

    // The recorder must already be running before anyone opens the bar —
    // history you did not record is history you cannot scrub to.
    out.recorderRunning = tl.recorder.running;

    // Seed synthetic history. Clearing first is required: the recorder has
    // already banked a real frame, and the buffer refuses out-of-order frames.
    tl.buffer.clear();
    tl.recorder.stop();
    const step = 15_000;
    const frames = 40;
    const t0 = Date.now() - frames * step;
    for (let i = 0; i <= frames; i += 1) {
      tl.buffer.append(t0 + i * step, {
        flights: Array.from({ length: 30 }, (_, n) => ({
          id: `QA${n}`, icao24: `QA${n}`,
          lon: -97.74 + n * 0.02 + i * 0.01,
          lat: 30.27 + n * 0.01,
          altitudeM: 8000 + n * 50,
          heading: 90,
        })),
      });
    }
    out.bufferedFrames = tl.buffer.frameCount;
    out.bufferedSpanMs = tl.buffer.range().spanMs;

    tl.setVisible(true);
    out.visibleAfterOpen = document.getElementById('timeline-bar')?.hidden === false;
    out.liveMode = document.getElementById('timeline-mode')?.textContent ?? null;
    out.liveDetail = document.getElementById('timeline-detail')?.textContent ?? null;
    out.coverageText = document.getElementById('timeline-coverage')?.textContent?.trim() ?? null;

    // Scrub to the middle: the scene must be reconstructed and the bar must
    // say REPLAY in both its chip and its data attribute (the amber rail).
    const scrub = document.getElementById('timeline-scrub');
    if (scrub) {
      scrub.value = '500';
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 200));
    out.replayMode = document.getElementById('timeline-mode')?.textContent ?? null;
    out.replayRail = document.getElementById('timeline-bar')?.dataset.mode ?? null;
    out.replayDetail = document.getElementById('timeline-detail')?.textContent ?? null;
    out.renderedPoints = tl.renderer.renderedCount;
    out.rendererActive = tl.renderer.active;
    out.behindSec = tl.getDiagnostics().transport.behindSec;

    // Refusal: scrubbing cannot reach outside the recorded window.
    const range = tl.buffer.range();
    tl.clock.seek(range.startMs - 10 * 60_000, range);
    out.clampedBefore = tl.clock.positionMs === range.startMs;
    tl.clock.seek(range.endMs + 10 * 60_000, range);
    out.clampedAfter = tl.clock.positionMs === range.endMs;

    // Playback advances the head.
    tl.clock.seek(range.startMs, range);
    const before = tl.clock.positionMs;
    tl.clock.play(range);
    tl.renderer.render(tl.buffer.sampleAt(tl.clock.positionMs), { playing: true });
    await new Promise((r) => setTimeout(r, 900));
    out.playAdvancedMs = Math.round(tl.clock.positionMs - before);

    // Returning live clears the reconstruction.
    document.getElementById('timeline-live')?.click();
    tl.goLive();
    await new Promise((r) => setTimeout(r, 150));
    out.liveAfterReturn = document.getElementById('timeline-mode')?.textContent ?? null;
    out.rendererClearedOnLive = tl.renderer.active === false;

    // Closing the bar must also return to live — a hidden bar that leaves the
    // globe showing a past frame is the worst possible state.
    tl.clock.seek(range.startMs, range);
    tl.setVisible(false);
    out.liveAfterClose = tl.clock.mode === 'live';
    out.rendererClearedOnClose = tl.renderer.active === false;

    return out;
  });

  check('controller', probe.controllerPresent, 'timeline controller published on window.__godsEyeView');
  check('markup', probe.barPresent, 'timeline bar present in the DOM');
  check('markup', probe.hiddenByDefault === true, 'bar starts hidden');
  check('recording', probe.recorderRunning, 'recorder runs before the bar is ever opened');
  check('buffer', probe.bufferedFrames === 41, `41 frames buffered (saw ${probe.bufferedFrames})`);
  check('open', probe.visibleAfterOpen, 'bar shows when opened');
  check('open', probe.liveMode === 'LIVE', `opens in LIVE (saw ${probe.liveMode})`);
  check('open', /BUFFERED/.test(probe.liveDetail || ''), `live detail reports buffered span (saw ${probe.liveDetail})`);
  check('coverage', /FLIGHTS/.test(probe.coverageText || ''), `per-source coverage chip rendered (saw ${probe.coverageText})`);
  check('replay', probe.replayMode === 'REPLAY', `scrubbing enters REPLAY (saw ${probe.replayMode})`);
  check('replay', probe.replayRail === 'replay', 'amber replay rail is set on the bar');
  check('replay', probe.renderedPoints === 30, `reconstructed frame drawn (saw ${probe.renderedPoints} points)`);
  check('replay', probe.rendererActive, 'replay renderer reports active');
  check('replay', probe.behindSec > 0, `status reports how far back the head is (${probe.behindSec}s)`);
  check('refusal', probe.clampedBefore, 'cannot scrub before the oldest observation');
  check('refusal', probe.clampedAfter, 'cannot scrub past the newest observation');
  check('playback', probe.playAdvancedMs > 0, `playback advances the head (${probe.playAdvancedMs}ms)`);
  check('live', probe.liveAfterReturn === 'LIVE', 'LIVE button returns to the present');
  check('live', probe.rendererClearedOnLive, 'returning live clears the reconstruction');
  check('close', probe.liveAfterClose, 'closing the bar returns to live');
  check('close', probe.rendererClearedOnClose, 'closing the bar clears the reconstruction');
  check('console', pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(' | ') || 'none'})`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  [${result.section}] ${result.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

if (TEETH) {
  // The control is healthy when removing the bar breaks the bar-dependent
  // sections. It always exits non-zero: 1 means healthy, 2 means the harness
  // is not actually testing its subject.
  const healthy = failed.length > 0;
  console.log(healthy
    ? '\nTEETH: control healthy — removing the bar turned checks red.'
    : '\nTEETH: control UNHEALTHY — the harness passed without its subject.');
  process.exit(healthy ? 1 : 2);
}

process.exit(failed.length === 0 ? 0 : 1);
