// RainViewer frame index. The choices pinned here are: newest OBSERVED frame
// only (nowcast is a forecast and is excluded), tolerance of an unordered
// frame array, and refusal to join a path the payload did not shape correctly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newestFrame,
  parseWeatherMaps,
  buildTileUrl,
  frameAgeText,
  RADAR_TILE_OPTIONS,
  SATELLITE_TILE_OPTIONS,
  RAINVIEWER_FALLBACK_HOST,
  RAINVIEWER_TILE_SIZE,
} from './rainviewerFrames.js';

const payload = {
  version: '2.0',
  generated: 1_700_000_600,
  host: 'https://tilecache.rainviewer.com',
  radar: {
    past: [
      { time: 1_700_000_000, path: '/v2/radar/1700000000' },
      { time: 1_700_000_600, path: '/v2/radar/1700000600' },
    ],
    nowcast: [{ time: 1_700_001_200, path: '/v2/radar/nowcast_abc' }],
  },
  satellite: {
    infrared: [{ time: 1_700_000_400, path: '/v2/satellite/1700000400' }],
  },
};

test('the newest frame is chosen by timestamp, not by array position', () => {
  // The array is external input; trusting its ordering would be a guess.
  const frames = [
    { time: 300, path: '/c' },
    { time: 100, path: '/a' },
    { time: 200, path: '/b' },
  ];
  assert.deepEqual(newestFrame(frames), { time: 300, path: '/c' });
});

test('frames missing a time or a path are skipped', () => {
  assert.deepEqual(newestFrame([{ time: 5 }, { path: '/x' }, { time: 3, path: '/ok' }]),
    { time: 3, path: '/ok' });
  assert.equal(newestFrame([]), null);
  assert.equal(newestFrame(null), null);
  assert.equal(newestFrame('nope'), null);
});

test('NOWCAST IS EXCLUDED — only the newest observed radar frame is used', () => {
  // radar.nowcast here is NEWER than every past frame. Picking it would render
  // a forecast identically to an observation, with nothing saying so.
  const parsed = parseWeatherMaps(payload);
  assert.equal(parsed.radar.time, 1_700_000_600);
  assert.equal(parsed.radar.path, '/v2/radar/1700000600');
  assert.doesNotMatch(parsed.radar.path, /nowcast/);
});

test('the satellite infrared frame is read', () => {
  const parsed = parseWeatherMaps(payload);
  assert.equal(parsed.satellite.time, 1_700_000_400);
  assert.equal(parsed.satellite.path, '/v2/satellite/1700000400');
});

test('the payload host wins, so RainViewer can move its tile cache', () => {
  assert.equal(parseWeatherMaps(payload).host, 'https://tilecache.rainviewer.com');
  assert.equal(parseWeatherMaps({ ...payload, host: 'https://other.example/' }).host,
    'https://other.example', 'a trailing slash is normalised away');
});

test('a payload with no host falls back rather than producing a broken URL', () => {
  assert.equal(parseWeatherMaps({ ...payload, host: null }).host, RAINVIEWER_FALLBACK_HOST);
});

test('a malformed payload yields nulls, not throws', () => {
  for (const input of [null, {}, { radar: null }, { radar: { past: null } }, 'nope']) {
    const parsed = parseWeatherMaps(input);
    assert.equal(parsed.radar, null);
    assert.equal(parsed.satellite, null);
    assert.ok(parsed.host, 'a host is always present so callers need not branch');
  }
});

test('radar and satellite tile URLs carry their own rendering options', () => {
  const radar = buildTileUrl({
    host: 'https://tilecache.rainviewer.com',
    path: '/v2/radar/1700000600',
    options: RADAR_TILE_OPTIONS,
  });
  assert.equal(radar,
    `https://tilecache.rainviewer.com/v2/radar/1700000600/${RAINVIEWER_TILE_SIZE}/{z}/{x}/{y}/2/1_1.png`);

  const satellite = buildTileUrl({
    host: 'https://tilecache.rainviewer.com',
    path: '/v2/satellite/1700000400',
    options: SATELLITE_TILE_OPTIONS,
  });
  assert.equal(satellite,
    `https://tilecache.rainviewer.com/v2/satellite/1700000400/${RAINVIEWER_TILE_SIZE}/{z}/{x}/{y}/0/0_0.png`);
});

test('the two overlays render with genuinely different options', () => {
  assert.notDeepEqual(RADAR_TILE_OPTIONS, SATELLITE_TILE_OPTIONS);
});

test('REFUSES a path the payload did not shape correctly', () => {
  // The path is external input appended to a host we chose. Anything that is
  // not a plain absolute path is refused rather than joined.
  const base = { host: 'https://tilecache.rainviewer.com', options: RADAR_TILE_OPTIONS };
  assert.equal(buildTileUrl({ ...base, path: 'v2/radar/1' }), null, 'must be absolute');
  assert.equal(buildTileUrl({ ...base, path: '/v2/../../etc' }), null, 'traversal is refused');
  assert.equal(buildTileUrl({ ...base, path: '' }), null);
  assert.equal(buildTileUrl({ ...base, path: null }), null);
  assert.equal(buildTileUrl({ host: null, path: '/v2/radar/1', options: {} }), null);
});

test('tile URLs keep the XYZ placeholders unsubstituted for Cesium', () => {
  const url = buildTileUrl({ host: 'https://h', path: '/p', options: RADAR_TILE_OPTIONS });
  assert.match(url, /\{z\}\/\{x\}\/\{y\}/);
});

test('frame age reads in the units a person cares about', () => {
  const now = 1_700_003_600_000;
  assert.equal(frameAgeText(1_700_003_600, now), 'UNDER 1 MIN OLD');
  assert.equal(frameAgeText(1_700_003_000, now), '10 MIN OLD');
  assert.equal(frameAgeText(1_700_000_000, now), '1H 00M OLD');
  assert.equal(frameAgeText(null, now), 'AGE UNKNOWN');
});

test('a badly stale frame says so instead of printing an absurd hour count', () => {
  // A live frame is minutes old. This branch only fires for a stalled feed or
  // a skewed clock, where "24463H 48M OLD" is noise rather than information.
  const now = 1_800_000_000_000;
  assert.equal(frameAgeText(1_800_000_000 - 3 * 86_400, now), '3D OLD · FEED LOOKS STALLED');
  assert.equal(frameAgeText(1_700_000_000, now), 'STALE — NO RECENT FRAME');
  // ...while the useful range keeps its precision.
  assert.equal(frameAgeText(1_800_000_000 - 5 * 3600, now), '5H 00M OLD');
});

test('a frame timestamped slightly ahead of the clock is not reported as negative', () => {
  // Client clock skew against RainViewer's is routine and must not produce
  // "-2 MIN OLD".
  assert.equal(frameAgeText(1_700_000_100, 1_700_000_000_000), 'JUST PUBLISHED');
});

test('frame timestamps are treated as SECONDS, which is RainViewer units', () => {
  // Misreading them as milliseconds would date every frame to 1970 and make
  // the age readout nonsense.
  assert.equal(frameAgeText(1_700_000_000, 1_700_000_000_000), 'UNDER 1 MIN OLD');
});
