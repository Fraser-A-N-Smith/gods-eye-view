/**
 * @module copernicusImagery
 * @description Copernicus Sentinel imagery as map-stack sources.
 *
 * Sentinel-1 is synthetic aperture radar: it images through cloud and at
 * night, because it supplies its own illumination at a wavelength weather does
 * not stop. Sentinel-2 is 10 m optical. Both are free from ESA's Copernicus
 * Data Space, which is the direct answer to the ceiling this project's README
 * names — that SAR and premium imagery live behind enterprise contracts. For a
 * large part of what people actually want imagery for, they no longer do.
 *
 * ## Why these go through our own proxy
 *
 * Unlike NASA GIBS, Copernicus is not an anonymous tile server. Access needs
 * an OAuth client-credentials token, and the token must never reach the
 * browser. So the stacks point at `/api/copernicus/tiles/...` on this server,
 * which holds the credentials, mints and caches the token, and translates each
 * XYZ tile request into a Sentinel Hub WMS request.
 *
 * Going through WMS with an explicit bounding box, rather than WMTS, is
 * deliberate: WMTS would tie us to Sentinel Hub's tile-matrix identifiers,
 * which vary by configuration instance. A bbox computed from z/x/y is the same
 * arithmetic everywhere.
 *
 * ## Availability is probed, not assumed
 *
 * These stacks need three environment values (client id, client secret,
 * configuration instance id). The controller cannot know at construction
 * whether they are set, so the stacks declare `requiresRuntimeProbe` and start
 * UNAVAILABLE until `/api/copernicus/status` says otherwise. Failing closed
 * means a keyless install shows a clear reason instead of a black globe.
 */

import * as Cesium from 'cesium';

/** Required attribution for Copernicus data. */
export const COPERNICUS_CREDIT = 'Contains modified Copernicus Sentinel data — ESA';

/** Tile size served by the proxy. */
export const COPERNICUS_TILE_SIZE = 512;

/**
 * Deepest zoom offered.
 *
 * Sentinel-2 is 10 m/px and Sentinel-1 GRD around 10–20 m. Past roughly z14 a
 * request returns upsampled mush that looks like detail without being any, so
 * the stack stops rather than inviting the zoom.
 */
export const COPERNICUS_MAX_LEVEL = 14;

/**
 * Sentinel-backed map stacks.
 *
 * `layerId` is the layer name configured in the operator's Sentinel Hub
 * instance. The defaults match the layer names Copernicus provisions in a new
 * configuration; an instance that renames them needs these updated to match.
 */
export const COPERNICUS_STACKS = Object.freeze([
  Object.freeze({
    id: 'sentinel2-truecolor',
    label: 'Sentinel-2',
    shortLabel: 'S2',
    kind: 'copernicus',
    requiresIon: false,
    requiresRuntimeProbe: true,
    copernicus: { layerId: 'TRUE-COLOR', format: 'image/jpeg' },
    coverage: 'GLOBAL · 10 M OPTICAL · CLOUD-BLOCKED, REVISIT ~5 DAYS',
    attribution: COPERNICUS_CREDIT,
  }),
  Object.freeze({
    id: 'sentinel1-sar',
    label: 'Sentinel-1 SAR',
    shortLabel: 'SAR',
    kind: 'copernicus',
    requiresIon: false,
    requiresRuntimeProbe: true,
    copernicus: { layerId: 'SENTINEL-1-GRD', format: 'image/jpeg' },
    coverage: 'RADAR · SEES THROUGH CLOUD AND DARKNESS · NOT A PHOTOGRAPH',
    attribution: COPERNICUS_CREDIT,
  }),
]);

/**
 * Build the imagery provider for a Copernicus stack.
 *
 * Points at this server's own proxy, never at Copernicus directly — the
 * credentials live server-side and a browser request could not authenticate
 * even if it wanted to.
 *
 * @param {object} stack Stack descriptor.
 * @param {object} [deps] Injected constructor, for tests.
 * @returns {object} Cesium imagery provider.
 */
export function createCopernicusImageryProvider(stack, deps = {}) {
  const spec = stack?.copernicus;
  if (!spec?.layerId) {
    throw new Error(`Map stack ${stack?.id || '(unknown)'} is missing its Copernicus descriptor`);
  }
  const Provider = deps.UrlTemplateImageryProvider || Cesium.UrlTemplateImageryProvider;
  return new Provider({
    url: `/api/copernicus/tiles/${encodeURIComponent(stack.id)}/{z}/{x}/{y}`,
    tileWidth: COPERNICUS_TILE_SIZE,
    tileHeight: COPERNICUS_TILE_SIZE,
    maximumLevel: COPERNICUS_MAX_LEVEL,
    credit: stack.attribution || COPERNICUS_CREDIT,
  });
}

export default COPERNICUS_STACKS;
