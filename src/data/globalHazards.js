import * as Cesium from 'cesium';
import { mapEonetFeature, mapGdacsFeature } from './globalHazardsShape.js';
import { addUniqueEntity } from './entityDedupe.js';

/**
 * Global Hazards — GDACS floods & droughts, merged with the NASA EONET
 * classes that no other layer already covers (severe storms, landslides,
 * sea/lake ice, temperature extremes, dust/haze, snow, water color).
 *
 * Fetched through the server-side `/api/global-hazards` proxy, never
 * directly from gdacs.org or eonet.gsfc.nasa.gov — neither upstream's CORS
 * posture is reliable for a direct browser fetch (same reasoning as
 * `spaceWeatherProxy`'s doc comment in vite.config.js). The proxy does the
 * GDACS/EONET fetch, filter, and merge (via the SAME `mapGdacsFeature`/
 * `mapEonetFeature` imported below — see `globalHazardsShape.js`) and hands
 * back a flat `{ hazards: [...], retrievedAt }` payload already in this
 * layer's record shape, so `update()` below only needs to place points — it
 * does not re-run the filtering rules against raw upstream JSON.
 *
 * `mapGdacsFeature`/`mapEonetFeature` are re-exported here (not merely
 * imported) so this module's public interface is unchanged: they are pure
 * and Cesium-free, live in `globalHazardsShape.js` precisely so
 * `vite.config.js` can import the SAME implementation the proxy actually
 * runs without dragging this file's `cesium` import into that Node-only
 * process (mirroring the existing `spaceWeatherShape.js` precedent). One
 * implementation, tested once, in `globalHazardsShape.test.mjs`.
 *
 * Each hazard renders as a small colored point (not an ellipse — these are
 * discrete alert markers, not magnitude-scaled zones) with a `kind` label,
 * sized/colored by GDACS-style alert severity: Red is bigger and red,
 * Orange (including every EONET event, which carries no GDACS-style alert
 * level) is smaller and orange.
 */

const API_URL = '/api/global-hazards';

export const GLOBAL_HAZARDS_OVERLAY_SOURCE_ID = 'global-hazards';

export { mapEonetFeature, mapGdacsFeature };

/** Point styling by GDACS-style alert severity. Anything but 'Red' reads as Orange. */
function severityStyle(severity) {
  if (severity === 'Red') return { color: Cesium.Color.RED, pixelSize: 14 };
  return { color: Cesium.Color.ORANGE, pixelSize: 9 };
}

/**
 * Map one hazard's raw plain values (as pulled off an entity's `properties`,
 * or straight from the proxy payload) to a JSON-safe analyst record (analyst
 * query engine seam). Pure — no Cesium types. Missing/unknown fields are
 * null, never NaN/undefined. Falls back to an index-based id when the
 * upstream id is absent.
 * @param {Object|null|undefined} raw - Plain values:
 *   {id, source, kind, title, lat, lon, severity, dateMs}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, source: string|null, kind: string|null, title: string|null,
 *   lat: number|null, lon: number|null, severity: string|null, dateMs: number|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `HAZARD-${String(index).padStart(4, '0')}`,
    source: text(raw?.source),
    kind: text(raw?.kind),
    title: text(raw?.title),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    severity: text(raw?.severity),
    dateMs: num(raw?.dateMs),
  };
}

export function createGlobalHazardsLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _duplicatesSkipped = 0;

  const layer = {
    id: 'global-hazards',
    name: 'Global Hazards (GDACS + EONET)',
    icon: '🚨',
    source: 'GDACS / NASA EONET',
    updateInterval: 300000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('global-hazards');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:GlobalHazards] Initialized');
    },

    enable(viewer) {
      if (_dataSource) _dataSource.show = true;
    },

    disable(viewer) {
      if (_dataSource) _dataSource.show = false;
    },

    async update(viewer) {
      try {
        const response = await fetch(API_URL);
        if (!response.ok) {
          _lastError = `Global Hazards HTTP ${response.status}`;
          console.warn(`[Data:GlobalHazards] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.hazards)) {
          _lastError = 'Malformed global hazards response';
          return false;
        }

        _dataSource.entities.removeAll();
        const seenIds = new Set();
        let count = 0;
        let skipped = 0;

        for (const hazard of payload.hazards) {
          const lat = Number(hazard?.lat);
          const lon = Number(hazard?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const style = severityStyle(hazard.severity);
          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          const stableId = hazard.id || `hazard-${count}`;

          const added = addUniqueEntity(_dataSource.entities, seenIds, {
            id: `hazard:${stableId}`,
            position,
            point: {
              pixelSize: style.pixelSize,
              color: style.color,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: String(hazard.kind ?? ''),
              font: '12px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -12),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              // Analyst seam (additive): the proxy-assigned hazard id.
              hazardId: hazard.id ?? null,
              source: hazard.source ?? null,
              kind: hazard.kind ?? null,
              title: hazard.title ?? null,
              severity: hazard.severity ?? null,
              url: hazard.url ?? null,
              dateMs: hazard.dateMs ?? null,
            },
          });
          if (!added) skipped++;
        }

        _count = count - skipped;
        _duplicatesSkipped = skipped;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:GlobalHazards] Updated: ${_count} hazards`);
        return true;

      } catch (e) {
        console.warn('[Data:GlobalHazards] Fetch error:', e);
        _lastError = 'Global Hazards network error';
        return false;
      }
    },

    destroy(viewer) {
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _duplicatesSkipped = 0;
    },

    /**
     * Snapshot the layer's in-memory hazard records as plain JSON-safe
     * objects for the analyst query engine. On-demand only (called at most
     * once per spoken query) — zero per-frame cost, no listeners, no caching.
     * Returns [] while the layer is disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return (truncation).
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const entities = _dataSource.entities.values;
      if (!entities.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 2000;
      const now = Cesium.JulianDate.now();
      const result = [];
      for (const entity of entities) {
        if (result.length >= limit) break;
        const cartesian = entity.position ? entity.position.getValue(now) : null;
        const carto = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
        const p = entity.properties;
        result.push(mapAnalystRecord({
          id: p?.hazardId?.getValue(now) ?? null,
          source: p?.source?.getValue(now),
          kind: p?.kind?.getValue(now),
          title: p?.title?.getValue(now),
          severity: p?.severity?.getValue(now),
          dateMs: p?.dateMs?.getValue(now),
          lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
          lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
        }, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
        duplicatesSkipped: _duplicatesSkipped,
      };
    },
  };
  return layer;
}

const globalHazardsLayer = createGlobalHazardsLayer();

export default globalHazardsLayer;
