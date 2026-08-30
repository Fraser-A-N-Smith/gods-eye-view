// Slippy-tile to Web Mercator conversion. A subtle error here produces imagery
// that is plausibly framed and geographically wrong, which is the hardest kind
// of bug to spot on a globe — so the axis direction is pinned explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileBBox3857, parseTilePath, MERCATOR_HALF_WORLD } from './tileMath.js';

test('the level-0 tile is the whole Mercator world', () => {
  const box = tileBBox3857(0, 0, 0);
  assert.ok(Math.abs(box.minX + MERCATOR_HALF_WORLD) < 1e-6);
  assert.ok(Math.abs(box.maxX - MERCATOR_HALF_WORLD) < 1e-6);
  assert.ok(Math.abs(box.minY + MERCATOR_HALF_WORLD) < 1e-6);
  assert.ok(Math.abs(box.maxY - MERCATOR_HALF_WORLD) < 1e-6);
});

test('Y COUNTS FROM THE NORTH — flipping it mirrors the world about the equator', () => {
  const north = tileBBox3857(1, 0, 0);
  const south = tileBBox3857(1, 0, 1);
  assert.ok(north.maxY > 0 && north.minY === 0, 'tile row 0 is the northern hemisphere');
  assert.ok(south.minY < 0 && south.maxY === 0, 'tile row 1 is the southern hemisphere');
  assert.ok(north.minY >= south.maxY, 'rows do not overlap');
});

test('X increases eastward from the antimeridian', () => {
  const west = tileBBox3857(1, 0, 0);
  const east = tileBBox3857(1, 1, 0);
  assert.ok(Math.abs(west.minX + MERCATOR_HALF_WORLD) < 1e-6);
  assert.equal(west.maxX, 0);
  assert.equal(east.minX, 0);
  assert.ok(Math.abs(east.maxX - MERCATOR_HALF_WORLD) < 1e-6);
});

test('tiles at a level tile the world exactly, with no gaps or overlap', () => {
  const z = 3;
  const tiles = 2 ** z;
  const size = (MERCATOR_HALF_WORLD * 2) / tiles;
  for (let x = 0; x < tiles; x += 1) {
    for (let y = 0; y < tiles; y += 1) {
      const box = tileBBox3857(z, x, y);
      assert.ok(Math.abs((box.maxX - box.minX) - size) < 1e-6, 'uniform width');
      assert.ok(Math.abs((box.maxY - box.minY) - size) < 1e-6, 'uniform height');
      if (x > 0) {
        assert.ok(Math.abs(tileBBox3857(z, x - 1, y).maxX - box.minX) < 1e-6, 'abuts its western neighbour');
      }
    }
  }
});

test('out-of-range tiles are refused rather than producing a wrong box', () => {
  assert.equal(tileBBox3857(1, 2, 0), null, 'x past the level width');
  assert.equal(tileBBox3857(1, 0, 2), null, 'y past the level height');
  assert.equal(tileBBox3857(-1, 0, 0), null);
  assert.equal(tileBBox3857(99, 0, 0), null);
  assert.equal(tileBBox3857(1.5, 0, 0), null, 'a fractional zoom is not a tile');
  assert.equal(tileBBox3857('1', 0, 0), null, 'strings are not coerced');
});

test('tile paths parse only genuine integer triples', () => {
  assert.deepEqual(parseTilePath('/12/2048/1361'), { z: 12, x: 2048, y: 1361 });
  assert.deepEqual(parseTilePath('/sentinel1-sar/8/128/97'), { z: 8, x: 128, y: 97 });
  assert.deepEqual(parseTilePath('/8/128/97.jpg'), { z: 8, x: 128, y: 97 });
});

test('REJECTS rather than coerces — parseInt would read "01abc" as 1', () => {
  assert.equal(parseTilePath('/8/128/97abc'), null);
  assert.equal(parseTilePath('/a/b/c'), null);
  assert.equal(parseTilePath('/8/128'), null);
  assert.equal(parseTilePath('/-1/0/0'), null);
  assert.equal(parseTilePath('/8/128/-97'), null);
  assert.equal(parseTilePath(''), null);
  assert.equal(parseTilePath(null), null);
  assert.equal(parseTilePath('/../../etc/passwd'), null, 'traversal is not a tile triple');
});
