// NASA GIBS imagery stacks. These are the only map sources here whose content
// changes through the day, and the two shipped stacks have sharply different
// coverage and cadence — a global daily mosaic versus a ten-minute
// geostationary disc. The tests pin the URL contract (which cannot be checked
// against the live service from CI) and the honesty fields that keep those
// two from being read as the same kind of picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIBS_STACKS,
  GIBS_WMTS_BASE,
  GIBS_MATRIX_LEVELS,
  GIBS_TILE_SIZE,
  GIBS_CREDIT,
  gibsTileUrl,
  createGibsImageryProvider,
} from './gibsImagery.js';

/** Capture the options a provider would be constructed with. */
function captureProvider(stack) {
  let captured = null;
  class FakeProvider {
    constructor(options) { captured = options; }
  }
  class FakeTilingScheme {
    constructor(options) { this.options = options; }
  }
  createGibsImageryProvider(stack, {
    WebMapTileServiceImageryProvider: FakeProvider,
    GeographicTilingScheme: FakeTilingScheme,
  });
  return captured;
}

test('the tile URL follows the documented GIBS WMTS REST layout', () => {
  const url = gibsTileUrl('VIIRS_NOAA20_CorrectedReflectance_TrueColor', '250m', 'jpg');
  assert.equal(
    url,
    `${GIBS_WMTS_BASE}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/default/250m`
      + '/{TileMatrix}/{TileRow}/{TileCol}.jpg',
  );
});

test('the time dimension defaults to the newest available, not a pinned date', () => {
  // A hardcoded date would look right on the day it shipped and be silently
  // stale forever after.
  const url = gibsTileUrl('X', '2km', 'png');
  assert.match(url, /\/default\/default\//);
  const dated = gibsTileUrl('X', '2km', 'png', '2026-08-29');
  assert.match(dated, /\/default\/2026-08-29\//);
});

test('every shipped stack is keyless', () => {
  for (const stack of GIBS_STACKS) {
    assert.equal(stack.requiresIon, false, `${stack.id} must not need a key`);
    assert.equal(stack.kind, 'gibs');
  }
});

test('every shipped stack declares its own coverage and cadence', () => {
  // The two stacks are NOT interchangeable pictures of Earth, and the UI needs
  // to be able to say so without special-casing ids.
  for (const stack of GIBS_STACKS) {
    assert.ok(stack.coverage && stack.coverage.length > 10, `${stack.id} needs a coverage note`);
    assert.equal(stack.attribution, GIBS_CREDIT, `${stack.id} must carry NASA attribution`);
    assert.ok(stack.label && stack.shortLabel, `${stack.id} needs chip labels`);
  }
  const coverages = new Set(GIBS_STACKS.map((s) => s.coverage));
  assert.equal(coverages.size, GIBS_STACKS.length, 'each stack describes itself distinctly');
});

test('the global mosaic admits its swath seams; the geostationary disc admits its edge', () => {
  const byId = Object.fromEntries(GIBS_STACKS.map((s) => [s.id, s]));
  assert.match(byId['gibs-truecolor'].coverage, /GLOBAL/);
  assert.match(byId['gibs-truecolor'].coverage, /SEAMS ARE REAL/, 'orbit seams are data, not artifacts');
  assert.match(byId['gibs-geocolor'].coverage, /DISC ONLY/);
  assert.match(byId['gibs-geocolor'].coverage, /NO DATA OFF-DISC/, 'empty is not broken');
});

test('provider options match the GIBS geographic tiling contract', () => {
  const options = captureProvider(GIBS_STACKS[0]);
  assert.equal(options.tileWidth, GIBS_TILE_SIZE);
  assert.equal(options.tileHeight, GIBS_TILE_SIZE);
  // EPSG:4326 is two tiles across, one down, at level zero.
  assert.deepEqual(options.tilingScheme.options, { numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 });
  assert.equal(options.tileMatrixSetID, '250m');
  assert.equal(options.format, 'image/jpeg', 'jpg is spelled jpeg in a MIME type');
  assert.equal(options.credit, GIBS_CREDIT);
});

test('each stack is capped at the depth its tile matrix set actually publishes', () => {
  // Requesting past the published depth returns errors, not upsampled tiles.
  for (const stack of GIBS_STACKS) {
    const options = captureProvider(stack);
    assert.equal(options.maximumLevel, GIBS_MATRIX_LEVELS[stack.gibs.tileMatrixSet]);
    assert.ok(Number.isInteger(options.maximumLevel));
  }
});

test('png stacks keep their own MIME type', () => {
  const options = captureProvider(GIBS_STACKS.find((s) => s.gibs.format === 'png'));
  assert.equal(options.format, 'image/png');
});

test('a malformed stack descriptor fails loudly at construction', () => {
  assert.throws(() => createGibsImageryProvider({ id: 'broken' }), /missing its GIBS descriptor/);
  assert.throws(
    () => createGibsImageryProvider({ id: 'x', gibs: { layerId: 'L', tileMatrixSet: '17km' } }),
    /Unknown GIBS tile matrix set/,
  );
});

test('GIBS stacks are registered into MAP_STACKS and reach the chip tray', async () => {
  const { MAP_STACKS } = await import('./mapStackController.js');
  const { PRESENTED_MAP_STACK_IDS } = await import('./mapStackChips.js');
  for (const stack of GIBS_STACKS) {
    assert.ok(MAP_STACKS.some((s) => s.id === stack.id), `${stack.id} missing from MAP_STACKS`);
    assert.ok(PRESENTED_MAP_STACK_IDS.includes(stack.id), `${stack.id} missing from the tray allowlist`);
  }
});
