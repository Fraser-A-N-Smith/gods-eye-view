// Chrome discovery for the QA harnesses. The harnesses' own fallback lists
// name macOS paths only; this exists so Windows and Linux contributors get a
// real answer instead of an unhelpful failure when Puppeteer's own download
// is not present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformChromePaths, chromeCandidates, resolveChrome } from './chrome.mjs';

test('each platform gets its own conventional locations', () => {
  assert.ok(platformChromePaths('darwin').every((p) => p.startsWith('/Applications/')));
  assert.ok(platformChromePaths('linux').every((p) => p.startsWith('/')));
  const win = platformChromePaths('win32', { PROGRAMFILES: 'C:\\Program Files' });
  assert.ok(win.length > 0);
  assert.ok(win.every((p) => p.endsWith('.exe')));
});

test('WINDOWS: locations come from the Program Files variables, not literal paths', () => {
  // Those directories are localized on non-English installs, so hardcoding
  // "C:\\Program Files" would miss them.
  const win = platformChromePaths('win32', {
    PROGRAMFILES: 'D:\\Programme',
    LOCALAPPDATA: 'D:\\Users\\x\\AppData\\Local',
  });
  assert.ok(win.some((p) => p.startsWith('D:\\Programme')));
  assert.ok(win.some((p) => p.startsWith('D:\\Users\\x\\AppData\\Local')));
});

test('WINDOWS: absent environment variables are skipped, not turned into junk paths', () => {
  const win = platformChromePaths('win32', {});
  assert.deepEqual(win, [], 'no roots means no candidates, rather than "undefined/Google/..."');
});

test('an explicit override wins over everything', () => {
  const candidates = chromeCandidates({
    platform: 'darwin',
    env: { PUPPETEER_EXECUTABLE_PATH: '/custom/chrome' },
    puppeteerPath: '/puppeteer/chrome',
  });
  assert.equal(candidates[0], '/custom/chrome');
  assert.equal(candidates[1], '/puppeteer/chrome');
});

test("puppeteer's own download is preferred over system installs", () => {
  const candidates = chromeCandidates({ platform: 'linux', env: {}, puppeteerPath: '/pptr/chrome' });
  assert.equal(candidates[0], '/pptr/chrome');
});

test('resolveChrome returns the first candidate that exists', () => {
  const found = resolveChrome({
    platform: 'linux',
    env: {},
    puppeteerPath: '/pptr/chrome',
    exists: (p) => p === '/usr/bin/chromium',
  });
  assert.equal(found, '/usr/bin/chromium');
});

test('finding nothing returns undefined, which puppeteer treats as "use your own"', () => {
  const found = resolveChrome({ platform: 'linux', env: {}, exists: () => false });
  assert.equal(found, undefined, 'undefined is a valid answer, not an error');
});
