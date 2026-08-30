/**
 * @module data/numeric
 * @description Strict coercion helpers for values arriving from external feeds.
 *
 * These exist because `Number()` treats absence as zero. `Number(null)`,
 * `Number('')`, `Number([])` and `Number(false)` are all `0`, which silently
 * converts "this feed did not tell us" into "this feed told us zero". That
 * distinction is the difference between a wildfire of unknown size and a
 * wildfire of no size, and between a missing geomagnetic index and a quiet
 * one — a bug this repo has now hit three times in three different layers.
 *
 * Anything reading a numeric field out of third-party JSON should come through
 * here rather than calling Number() directly.
 */

/**
 * Finite number, or null.
 *
 * Absence (null, undefined, empty/whitespace string) and non-numeric values
 * both yield null. Booleans are rejected too: `Number(true)` is 1, and a feed
 * that put a flag where a measurement belongs is malformed, not "one".
 *
 * @param {*} value Raw feed value.
 * @returns {number|null}
 */
export function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Trimmed non-empty string, or null.
 * @param {*} value Raw feed value.
 * @returns {string|null}
 */
export function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * Finite number clamped into a range, or null when absent.
 * @param {*} value Raw feed value.
 * @param {number} min Lower bound.
 * @param {number} max Upper bound.
 * @returns {number|null}
 */
export function clampedOrNull(value, min, max) {
  const parsed = finiteOrNull(value);
  if (parsed === null) return null;
  return Math.min(max, Math.max(min, parsed));
}
