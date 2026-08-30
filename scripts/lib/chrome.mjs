/**
 * @module scripts/lib/chrome
 * @description Cross-platform Chrome discovery for the QA harnesses.
 *
 * Every harness needs a browser binary, and the fallback lists scattered
 * through them name only macOS application paths. That is mostly harmless —
 * `puppeteer.executablePath()` resolves first and points at Puppeteer's own
 * download on every platform — but it means a contributor who has Chrome
 * installed and Puppeteer's browser removed gets an unhelpful failure on
 * Windows and Linux where a Mac would have recovered.
 *
 * Candidates are tried in order: an explicit override, Puppeteer's own
 * download, then the conventional install locations for the running platform.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Conventional Chrome/Chromium locations per platform.
 * @param {string} platform Node platform id.
 * @param {Object<string,string>} env Environment, for Windows program dirs.
 * @returns {Array<string>}
 */
export function platformChromePaths(platform = process.platform, env = process.env) {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  if (platform === 'win32') {
    // The Program Files variables are the supported way to find these; their
    // literal paths differ on non-English installs and on 32-bit hosts.
    const roots = [
      env.LOCALAPPDATA,
      env.PROGRAMFILES,
      env['PROGRAMFILES(X86)'],
    ].filter(Boolean);
    const suffixes = [
      path.join('Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join('Chromium', 'Application', 'chrome.exe'),
      path.join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    const out = [];
    for (const root of roots) for (const suffix of suffixes) out.push(path.join(root, suffix));
    return out;
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

/**
 * Ordered candidate list.
 * @param {object} [options]
 * @returns {Array<string>}
 */
export function chromeCandidates({
  platform = process.platform,
  env = process.env,
  puppeteerPath = null,
} = {}) {
  return [
    env.PUPPETEER_EXECUTABLE_PATH,
    puppeteerPath,
    ...platformChromePaths(platform, env),
  ].filter(Boolean);
}

/**
 * First candidate that exists on disk, or undefined.
 *
 * Undefined is a valid answer: Puppeteer falls back to its own resolution when
 * `executablePath` is undefined, so a harness should pass this straight through
 * rather than treating it as an error.
 *
 * @param {object} [options]
 * @returns {string|undefined}
 */
export function resolveChrome({
  platform = process.platform,
  env = process.env,
  puppeteerPath = null,
  exists = null,
} = {}) {
  const test = exists || ((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
  return chromeCandidates({ platform, env, puppeteerPath }).find(test);
}
