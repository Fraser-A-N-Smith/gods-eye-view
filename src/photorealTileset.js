/**
 * @module photorealTileset
 * @description Acquire the photorealistic 3D globe, with fallbacks.
 *
 * The app used to hard-throw at startup when `GOOGLE_MAPS_API_KEY` was unset,
 * which meant no key produced no app at all — a blank error screen rather than
 * the perfectly good keyless globe the map-stack controller has always
 * supported (#64). Separately, Google Maps Platform accounts billed in the EEA
 * can be refused by the Map Tiles API with a 401 even when the key is valid
 * and billing is live, leaving those users with no route to photoreal at
 * all (#59).
 *
 * Both are the same shape of problem: one unavailable source taking the whole
 * application down with it. So photoreal is now acquired through an ordered
 * chain, and running out of options degrades to a lesser globe instead of to
 * nothing:
 *
 *  1. **Google Photorealistic 3D Tiles** direct, via `GOOGLE_MAPS_API_KEY`.
 *     Unchanged and still preferred — it is the same imagery with one less
 *     intermediary, and it is what the key is for.
 *  2. **Cesium ion's mirror of the same imagery** (asset 2275207), via
 *     `CESIUM_ION_TOKEN`. ion serves the identical Google tiles through its
 *     own entitlement, which is why this works for EEA accounts whose direct
 *     Map Tiles API access 401s.
 *  3. **No photoreal.** The map stack falls back to the keyless OSM globe,
 *     which needs nothing at all.
 *
 * ## Failing forward, and saying so
 *
 * A configured source that FAILS is different from one that was never
 * configured, and the two must not be reported the same way. A missing key is
 * a choice; a 401 from a key the operator believes in is a problem they need
 * told about. Every attempt is recorded with its outcome so the loader line
 * and the console can distinguish "you have no key" from "your key was
 * rejected, here is what I did instead".
 */

/**
 * Cesium ion asset id for Google Photorealistic 3D Tiles.
 *
 * This is ion's published mirror of the same tileset, not a lookalike. Using
 * it keeps Google's attribution intact — the tileset carries its own credits —
 * and is the documented route for accounts that cannot reach the Map Tiles API
 * directly.
 */
export const PHOTOREAL_ION_ASSET_ID = 2275207;

/** Ordered source identifiers. */
export const PHOTOREAL_SOURCES = Object.freeze(['google', 'ion']);

/**
 * Decide which photoreal sources are worth attempting, in order.
 *
 * A source with no credential is not "skipped quietly" — it is returned as
 * ineligible with a reason, so the caller can tell the operator which knob
 * would have helped.
 *
 * @param {object} input
 * @param {string} [input.googleApiKey] Google Maps API key.
 * @param {string} [input.cesiumIonToken] Cesium ion access token.
 * @returns {Array<{id:string, eligible:boolean, label:string, reason:string|null}>}
 */
export function planPhotorealSources({ googleApiKey = '', cesiumIonToken = '' } = {}) {
  const hasGoogle = Boolean(String(googleApiKey || '').trim());
  const hasIon = Boolean(String(cesiumIonToken || '').trim());
  return [
    {
      id: 'google',
      label: 'Google Photorealistic 3D Tiles',
      eligible: hasGoogle,
      reason: hasGoogle ? null : 'GOOGLE_MAPS_API_KEY is not set',
    },
    {
      id: 'ion',
      label: 'Google 3D Tiles via Cesium ion',
      eligible: hasIon,
      reason: hasIon ? null : 'CESIUM_ION_TOKEN is not set',
    },
  ];
}

/**
 * One-line summary of how photoreal was acquired, for the loader and console.
 *
 * @param {object} outcome Result from loadPhotorealTileset.
 * @returns {string}
 */
export function describePhotorealOutcome(outcome) {
  const attempts = Array.isArray(outcome?.attempts) ? outcome.attempts : [];
  const failures = attempts.filter((attempt) => attempt.status === 'failed');

  if (outcome?.sourceId === 'google') {
    return 'Google Photorealistic 3D Tiles';
  }
  if (outcome?.sourceId === 'ion') {
    // The interesting case: the direct route was tried and refused. Naming it
    // is the difference between "this is normal" and "your Google key is being
    // rejected and you should know".
    const googleFailed = failures.some((attempt) => attempt.id === 'google');
    return googleFailed
      ? 'Google 3D Tiles via Cesium ion (direct Map Tiles API was refused)'
      : 'Google 3D Tiles via Cesium ion';
  }
  if (failures.length) {
    return `Photorealistic 3D unavailable (${failures.map((f) => f.detail).join('; ')}) — using the keyless OSM globe`;
  }
  return 'No Google Maps key or Cesium ion token — using the keyless OSM globe';
}

/**
 * Why the photoreal map stack cannot be selected, for the map-source tray.
 *
 * @param {object} outcome Result from loadPhotorealTileset.
 * @returns {string|null} Reason, or null when photoreal IS available.
 */
export function photorealUnavailableReason(outcome) {
  if (outcome?.tileset) return null;
  const attempts = Array.isArray(outcome?.attempts) ? outcome.attempts : [];
  const failed = attempts.filter((attempt) => attempt.status === 'failed');
  if (failed.length) {
    return `Photorealistic 3D failed to load: ${failed.map((f) => f.detail).join('; ')}`;
  }
  return 'Photorealistic 3D needs a Google Maps key, or a Cesium ion token to use the ion mirror';
}

/**
 * Load the photorealistic tileset, trying each configured source in order.
 *
 * Never throws: exhausting the chain is a valid outcome that leaves the app on
 * the keyless globe. That is the entire point — an unavailable basemap must
 * not be able to take the application down.
 *
 * @param {object} input
 * @param {string} [input.googleApiKey] Google Maps API key.
 * @param {string} [input.cesiumIonToken] Cesium ion access token.
 * @param {object} input.loaders Source loaders, keyed by source id.
 * @param {Function} [input.onAttempt] Progress callback, per source.
 * @returns {Promise<{tileset:object|null, sourceId:string|null, attempts:Array<object>}>}
 */
export async function loadPhotorealTileset({
  googleApiKey = '',
  cesiumIonToken = '',
  loaders = {},
  onAttempt = null,
} = {}) {
  const attempts = [];
  for (const source of planPhotorealSources({ googleApiKey, cesiumIonToken })) {
    if (!source.eligible) {
      attempts.push({ id: source.id, status: 'skipped', detail: source.reason });
      continue;
    }
    const loader = loaders[source.id];
    if (typeof loader !== 'function') {
      attempts.push({ id: source.id, status: 'skipped', detail: 'no loader supplied' });
      continue;
    }
    onAttempt?.(source);
    try {
      const tileset = await loader();
      if (!tileset) throw new Error('loader returned no tileset');
      attempts.push({ id: source.id, status: 'loaded', detail: null });
      return { tileset, sourceId: source.id, attempts };
    } catch (error) {
      // Recorded, then the chain continues. A failure here is exactly the
      // situation the fallback exists for.
      attempts.push({
        id: source.id,
        status: 'failed',
        detail: `${source.label}: ${error?.message || String(error)}`,
      });
    }
  }
  return { tileset: null, sourceId: null, attempts };
}
