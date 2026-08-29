/**
 * @module gibsImagery
 * @description NASA GIBS satellite imagery as map-stack sources.
 *
 * GIBS (Global Imagery Browse Services) serves near-real-time Earth imagery
 * over open WMTS with no key, no account and no signup — the same 🟢 tier as
 * USGS quakes or CelesTrak. It is what turns "a photorealistic globe" into
 * "the planet as it looked this morning": the polar-orbiter mosaics carry
 * today's cloud field worldwide, and the geostationary composites carry it at
 * a ten-minute cadence over their own hemisphere.
 *
 * ## Why these are map STACKS and not a data layer
 *
 * Cesium imagery draws on the globe surface, and this app hides the globe
 * whenever Google Photorealistic 3D Tiles are active (`globe.show = false` in
 * main.js — the 2D imagery otherwise clips through 3D buildings). An imagery
 * overlay therefore cannot be composited over photoreal at all; it can only be
 * the base. So GIBS joins Bing and OSM in the MAP SOURCE tray, where switching
 * the planet's skin is already the established idiom, rather than pretending to
 * be a toggleable overlay that would silently do nothing over photoreal.
 *
 * ## Honesty
 *
 * Every stack here declares its own coverage and cadence, because they differ
 * sharply and the difference matters:
 *
 *  - The polar-orbiter mosaics (VIIRS, MODIS) are GLOBAL but built from swaths
 *    collected across a day. Two adjacent pixels can be hours apart, and the
 *    seams between orbits are real, not artifacts.
 *  - The geostationary composites (GOES) are ten minutes old at best but cover
 *    only the disc their satellite can see. Outside that disc there is no data
 *    — the globe is genuinely empty there, not broken.
 *
 * The `attribution` and `coverage` fields below are surfaced to the user rather
 * than kept as developer trivia.
 *
 * ## Endpoint provenance
 *
 * The URL template and the layer/tile-matrix identifiers below are documented
 * GIBS values (see https://nasa-gibs.github.io/gibs-api-docs/). They are kept
 * as named constants in one place so that a service change is a one-line edit
 * rather than a hunt. If NASA retires or renames a layer, the stack fails the
 * way any unreachable source fails here: MapStackController catches the error,
 * reports it, and falls back to the photoreal globe.
 */

import * as Cesium from 'cesium';

/** GIBS WMTS REST endpoint for the geographic (EPSG:4326) projection. */
export const GIBS_WMTS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';

/** Required attribution for GIBS imagery. */
export const GIBS_CREDIT = 'Imagery courtesy NASA EOSDIS GIBS / Worldview';

/**
 * Levels available per GIBS EPSG:4326 tile matrix set. GIBS publishes a fixed
 * depth per resolution; requesting beyond it returns errors rather than
 * upsampled tiles, so the provider is capped here instead.
 */
export const GIBS_MATRIX_LEVELS = Object.freeze({
  '2km': 5,
  '1km': 6,
  '500m': 7,
  '250m': 8,
});

/** GIBS serves 512 px tiles in the geographic projection. */
export const GIBS_TILE_SIZE = 512;

/**
 * Build the WMTS REST URL template for one GIBS layer.
 *
 * The `default` in the path is the style dimension; the second segment is the
 * TIME dimension, where the literal `default` means "most recent available" —
 * which is what a live view wants, and what keeps this from pinning a date
 * that silently goes stale.
 *
 * @param {string} layerId GIBS layer identifier.
 * @param {string} tileMatrixSet GIBS tile matrix set (e.g. '250m').
 * @param {string} format Tile file extension, without the dot.
 * @param {string} [time] Time dimension value.
 * @returns {string} Cesium-compatible URL template.
 */
export function gibsTileUrl(layerId, tileMatrixSet, format, time = 'default') {
  return `${GIBS_WMTS_BASE}/${layerId}/default/${time}/${tileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.${format}`;
}

/**
 * GIBS-backed map stacks.
 *
 * Kept deliberately short. GIBS publishes over a thousand layers; the two here
 * are the ones that answer "what does Earth look like right now" — a global
 * daily mosaic and a near-real-time geostationary composite — and the list is
 * a starting point for anyone who wants to add their own.
 */
export const GIBS_STACKS = Object.freeze([
  {
    id: 'gibs-truecolor',
    label: 'Earth Today',
    shortLabel: 'Today',
    kind: 'gibs',
    requiresIon: false,
    gibs: {
      layerId: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
      tileMatrixSet: '250m',
      format: 'jpg',
    },
    coverage: 'GLOBAL · DAILY MOSAIC · SWATH SEAMS ARE REAL',
    attribution: GIBS_CREDIT,
  },
  {
    id: 'gibs-geocolor',
    label: 'GOES GeoColor',
    shortLabel: 'GOES',
    kind: 'gibs',
    requiresIon: false,
    gibs: {
      layerId: 'GOES-East_ABI_GeoColor',
      tileMatrixSet: '2km',
      format: 'png',
    },
    coverage: 'AMERICAS DISC ONLY · ~10 MIN · NO DATA OFF-DISC',
    attribution: GIBS_CREDIT,
  },
]);

/**
 * Construct a Cesium imagery provider for a GIBS stack descriptor.
 *
 * @param {object} stack Stack descriptor carrying a `gibs` block.
 * @param {object} [deps] Injected constructors, for tests.
 * @returns {object} Cesium imagery provider.
 */
export function createGibsImageryProvider(stack, deps = {}) {
  const spec = stack?.gibs;
  if (!spec?.layerId || !spec?.tileMatrixSet) {
    throw new Error(`Map stack ${stack?.id || '(unknown)'} is missing its GIBS descriptor`);
  }
  const maximumLevel = GIBS_MATRIX_LEVELS[spec.tileMatrixSet];
  if (maximumLevel === undefined) {
    throw new Error(`Unknown GIBS tile matrix set: ${spec.tileMatrixSet}`);
  }
  const Provider = deps.WebMapTileServiceImageryProvider
    || Cesium.WebMapTileServiceImageryProvider;
  const TilingScheme = deps.GeographicTilingScheme || Cesium.GeographicTilingScheme;

  return new Provider({
    url: gibsTileUrl(spec.layerId, spec.tileMatrixSet, spec.format, spec.time),
    layer: spec.layerId,
    style: 'default',
    format: `image/${spec.format === 'jpg' ? 'jpeg' : spec.format}`,
    tileMatrixSetID: spec.tileMatrixSet,
    // GIBS EPSG:4326 starts at two tiles across one down — the standard
    // geographic layout, stated explicitly rather than inherited by luck.
    tilingScheme: new TilingScheme({ numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 }),
    tileWidth: GIBS_TILE_SIZE,
    tileHeight: GIBS_TILE_SIZE,
    maximumLevel,
    credit: stack.attribution || GIBS_CREDIT,
  });
}

export default GIBS_STACKS;
