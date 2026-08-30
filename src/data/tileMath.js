/**
 * @module data/tileMath
 * @description Slippy-tile ↔ Web Mercator conversions.
 *
 * Used by the Copernicus tile proxy to turn an XYZ tile request into the
 * bounding box a WMS GetMap call needs. Pure arithmetic, kept separate because
 * getting it subtly wrong produces imagery that is plausibly framed and
 * geographically wrong — the hardest kind of bug to notice on a globe.
 */

/** Half the circumference of the Web Mercator world, in metres. */
export const MERCATOR_HALF_WORLD = 20_037_508.342789244;

/**
 * Bounding box of an XYZ tile in EPSG:3857 metres.
 *
 * Y is counted from the TOP in slippy-tile schemes, so the northern edge is
 * computed from `y` and the southern from `y + 1`. Flipping that mirrors the
 * imagery about the equator, which looks fine until you notice the coastline
 * is upside down.
 *
 * @param {number} z Zoom level.
 * @param {number} x Tile column.
 * @param {number} y Tile row, counted from the north.
 * @returns {{minX:number, minY:number, maxX:number, maxY:number}|null}
 */
export function tileBBox3857(z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 0 || z > 24) return null;
  const tiles = 2 ** z;
  if (x < 0 || x >= tiles || y < 0 || y >= tiles) return null;

  const size = (MERCATOR_HALF_WORLD * 2) / tiles;
  const minX = -MERCATOR_HALF_WORLD + x * size;
  const maxX = minX + size;
  const maxY = MERCATOR_HALF_WORLD - y * size;
  const minY = maxY - size;
  return { minX, minY, maxX, maxY };
}

/**
 * Parse a `/{z}/{x}/{y}` path tail into integers.
 *
 * Returns null for anything that is not three plain non-negative integers.
 * This is the boundary between a URL and arithmetic, so it rejects rather than
 * coerces: `parseInt` would happily read "01abc" as 1.
 *
 * @param {string} pathname Path containing the tile triple at its end.
 * @returns {{z:number, x:number, y:number}|null}
 */
export function parseTilePath(pathname) {
  const match = /(?:^|\/)(\d{1,2})\/(\d{1,9})\/(\d{1,9})(?:\.[a-z]{2,4})?$/i.exec(String(pathname || ''));
  if (!match) return null;
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { z, x, y };
}
