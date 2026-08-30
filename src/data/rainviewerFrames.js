/**
 * @module data/rainviewerFrames
 * @description Frame index and tile URLs for the RainViewer weather maps API.
 *
 * Pure module. `https://api.rainviewer.com/public/weather-maps.json` publishes
 * the currently available radar and satellite frames; each frame is a
 * timestamp plus a path, and a tile URL is assembled from the host, the frame
 * path, and per-overlay rendering options.
 *
 * ## Only observed frames — nowcast is deliberately excluded
 *
 * The radar block carries both `past` (observed sweeps) and `nowcast`
 * (extrapolated forecast). This module reads the newest PAST frame and ignores
 * nowcast entirely. A forecast rendered identically to an observation, with no
 * label distinguishing them, is exactly the kind of quiet claim this project
 * avoids elsewhere — and the scope here is the latest observed frame.
 *
 * ## Radar coverage is not global, and the layer has to say so
 *
 * Radar exists where somebody built and maintains a radar network. Most of the
 * ocean, much of Africa, central Asia and the poles have none. A blank area on
 * the radar overlay means NO RADAR THERE, not clear skies — the opposite
 * reading of the same pixels. The satellite IR overlay is near-global and does
 * not share that caveat, which is precisely why carrying both is useful.
 */

import { finiteOrNull, textOrNull } from './numeric.js';

/** Frame list endpoint. Keyless and CORS-open, so the browser fetches it directly. */
export const RAINVIEWER_FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json';

/** Tile size to request. 512 halves the request count versus 256 at the same coverage. */
export const RAINVIEWER_TILE_SIZE = 512;

/**
 * Fallback tile host.
 *
 * The payload carries its own `host`, which is what is used when present —
 * RainViewer can move the tile cache without touching clients. This is only
 * the floor for a payload that omits it.
 */
export const RAINVIEWER_FALLBACK_HOST = 'https://tilecache.rainviewer.com';

/**
 * Rendering options per overlay, appended to every tile path.
 *
 * `colorScheme` selects RainViewer's palette; `smooth` interpolates between
 * data points; `snow` renders snow separately from rain. Kept here as named
 * constants so the two overlays' looks are adjustable in one place.
 */
export const RADAR_TILE_OPTIONS = Object.freeze({ colorScheme: 2, smooth: 1, snow: 1 });
export const SATELLITE_TILE_OPTIONS = Object.freeze({ colorScheme: 0, smooth: 0, snow: 0 });

/**
 * Pick the newest frame from a frame array.
 *
 * RainViewer publishes frames in chronological order, so the newest is last —
 * but the array is external input, so this takes the maximum timestamp rather
 * than trusting the ordering.
 *
 * @param {Array<object>} frames Frame entries.
 * @returns {{time:number, path:string}|null}
 */
export function newestFrame(frames) {
  if (!Array.isArray(frames)) return null;
  let best = null;
  for (const frame of frames) {
    const time = finiteOrNull(frame?.time);
    const path = textOrNull(frame?.path);
    if (time === null || !path) continue;
    if (!best || time > best.time) best = { time, path };
  }
  return best;
}

/**
 * Parse the weather-maps payload into the newest observed frame per overlay.
 *
 * @param {object} payload Parsed weather-maps.json.
 * @returns {{host:string, generated:number|null, radar:object|null, satellite:object|null}}
 */
export function parseWeatherMaps(payload) {
  const host = textOrNull(payload?.host) || RAINVIEWER_FALLBACK_HOST;
  return {
    host: host.replace(/\/+$/, ''),
    generated: finiteOrNull(payload?.generated),
    // `past` only — see the module note on nowcast.
    radar: newestFrame(payload?.radar?.past),
    satellite: newestFrame(payload?.satellite?.infrared),
  };
}

/**
 * Build the XYZ tile URL template for one frame.
 *
 * Returns a Cesium-style template with `{z}/{x}/{y}` left unsubstituted.
 *
 * @param {object} input
 * @param {string} input.host Tile host from the payload.
 * @param {string} input.path Frame path from the payload.
 * @param {object} input.options Rendering options.
 * @param {number} [input.size] Tile size.
 * @returns {string|null} URL template, or null when the frame is unusable.
 */
export function buildTileUrl({ host, path, options, size = RAINVIEWER_TILE_SIZE }) {
  const cleanHost = textOrNull(host);
  const cleanPath = textOrNull(path);
  if (!cleanHost || !cleanPath) return null;
  // A path from an external payload is only ever appended to a host we chose;
  // anything that is not a plain absolute path is refused rather than joined.
  if (!cleanPath.startsWith('/') || cleanPath.includes('..')) return null;
  const { colorScheme = 0, smooth = 0, snow = 0 } = options || {};
  return `${cleanHost.replace(/\/+$/, '')}${cleanPath}/${size}/{z}/{x}/{y}/${colorScheme}/${smooth}_${snow}.png`;
}

/**
 * Human-readable age of a frame.
 * @param {number} frameTimeSec Frame timestamp, epoch SECONDS (RainViewer's unit).
 * @param {number} [nowMs] Current time.
 * @returns {string}
 */
export function frameAgeText(frameTimeSec, nowMs = Date.now()) {
  const time = finiteOrNull(frameTimeSec);
  if (time === null) return 'AGE UNKNOWN';
  const ageMs = nowMs - time * 1000;
  if (ageMs < 0) return 'JUST PUBLISHED';
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 1) return 'UNDER 1 MIN OLD';
  if (minutes < 60) return `${minutes} MIN OLD`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H ${String(minutes % 60).padStart(2, '0')}M OLD`;
  // Past a day the exact figure stops being information and starts being
  // noise — "24463H 48M OLD" tells a reader nothing except that something is
  // wrong, which is better said directly. A live frame is minutes old; this
  // branch only fires for a stalled feed or a badly skewed clock.
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}D OLD · FEED LOOKS STALLED`;
  return 'STALE — NO RECENT FRAME';
}
