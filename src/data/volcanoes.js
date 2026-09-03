import * as Cesium from 'cesium';
import { mapVolcanoFeature } from './volcanoesShape.js';
import { addUniqueEntity } from './entityDedupe.js';

/**
 * Active Volcanoes — Smithsonian Institution Global Volcanism Program (GVP),
 * filtered to volcanoes with a recorded eruption since 1900.
 *
 * Fetched through the server-side `/api/volcanoes` proxy, never directly
 * from webservices.volcano.si.edu — the upstream WFS service's CORS posture
 * is not reliable for a direct browser fetch (same reasoning as
 * `spaceWeatherProxy`'s doc comment in vite.config.js). The proxy does the
 * GVP fetch, eruption-year filter, and field mapping (via the SAME
 * `mapVolcanoFeature` imported below — see `volcanoesShape.js`) and hands
 * back a flat `{ volcanoes: [...], retrievedAt }` payload already in this
 * layer's record shape, so `update()` below only needs to place points — it
 * does not re-run the filtering rules against raw upstream JSON.
 *
 * `mapVolcanoFeature` is re-exported here (not merely imported) so this
 * module's public interface is unchanged: it is pure and Cesium-free, lives
 * in `volcanoesShape.js` precisely so `vite.config.js` can import the SAME
 * implementation the proxy actually runs without dragging this file's
 * `cesium` import into that Node-only process (mirroring the existing
 * `spaceWeatherShape.js`/`globalHazardsShape.js` precedent). One
 * implementation, tested once, in `volcanoesShape.test.mjs`.
 *
 * GVP eruption history is static-ish — it does not change day to day — so
 * `updateInterval` is a lazy hour, well above the proxy's 24h server-side TTL
 * so a poll is always served from cache in practice.
 *
 * Each volcano renders as a small colored point with a name label, colored
 * by recency band: eruptions since 2000 are red, since 1950 orange,
 * otherwise yellow (three-band scheme mirroring `earthquakes.js`'s
 * `depthColor` pattern).
 */

const API_URL = '/api/volcanoes';

export const VOLCANOES_OVERLAY_SOURCE_ID = 'volcanoes';

export { mapVolcanoFeature };

/**
 * Color by eruption recency:
 *  - This century (>= 2000): Red
 *  - Mid-20th-century-or-later (>= 1950): Orange
 *  - Earlier since 1900: Yellow
 */
function recencyStyle(lastEruptionYear) {
  if (lastEruptionYear >= 2000) return { color: Cesium.Color.RED, pixelSize: 12 };
  if (lastEruptionYear >= 1950) return { color: Cesium.Color.ORANGE, pixelSize: 10 };
  return { color: Cesium.Color.YELLOW, pixelSize: 8 };
}

/**
 * Map one volcano's raw plain values (as pulled off an entity's `properties`,
 * or straight from the proxy payload) to a JSON-safe analyst record (analyst
 * query engine seam). Pure — no Cesium types. Missing/unknown fields are
 * null, never NaN/undefined. Falls back to an index-based id when the
 * upstream id is absent.
 * @param {Object|null|undefined} raw - Plain values:
 *   {id, name, lat, lon, lastEruptionYear, country, volcanoType, elevationM}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, name: string|null, lat: number|null, lon: number|null,
 *   lastEruptionYear: number|null, country: string|null, volcanoType: string|null,
 *   elevationM: number|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `VOLCANO-${String(index).padStart(4, '0')}`,
    name: text(raw?.name),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    lastEruptionYear: num(raw?.lastEruptionYear),
    country: text(raw?.country),
    volcanoType: text(raw?.volcanoType),
    elevationM: num(raw?.elevationM),
  };
}

export function createVolcanoesLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _duplicatesSkipped = 0;

  const layer = {
    id: 'volcanoes',
    name: 'Active Volcanoes (Smithsonian GVP)',
    icon: '🌋',
    source: 'Smithsonian Institution — Global Volcanism Program',
    updateInterval: 3600000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('volcanoes');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:Volcanoes] Initialized');
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
          _lastError = `Volcanoes HTTP ${response.status}`;
          console.warn(`[Data:Volcanoes] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.volcanoes)) {
          _lastError = 'Malformed volcanoes response';
          return false;
        }

        _dataSource.entities.removeAll();
        const seenIds = new Set();
        let count = 0;
        let skipped = 0;

        for (const volcano of payload.volcanoes) {
          const lat = Number(volcano?.lat);
          const lon = Number(volcano?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const style = recencyStyle(Number(volcano.lastEruptionYear));
          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          const stableId = volcano.id || `volcano-${count}`;

          const added = addUniqueEntity(_dataSource.entities, seenIds, {
            id: `volcano:${stableId}`,
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
              text: String(volcano.name ?? ''),
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
              // Analyst seam (additive): the proxy-assigned volcano id.
              volcanoId: volcano.id ?? null,
              name: volcano.name ?? null,
              lastEruptionYear: volcano.lastEruptionYear ?? null,
              country: volcano.country ?? null,
              volcanoType: volcano.volcanoType ?? null,
              elevationM: volcano.elevationM ?? null,
            },
          });
          if (!added) skipped++;
        }

        _count = count - skipped;
        _duplicatesSkipped = skipped;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Volcanoes] Updated: ${_count} volcanoes`);
        return true;

      } catch (e) {
        console.warn('[Data:Volcanoes] Fetch error:', e);
        _lastError = 'Volcanoes network error';
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
     * Snapshot the layer's in-memory volcano records as plain JSON-safe
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
          id: p?.volcanoId?.getValue(now) ?? null,
          name: p?.name?.getValue(now),
          lastEruptionYear: p?.lastEruptionYear?.getValue(now),
          country: p?.country?.getValue(now),
          volcanoType: p?.volcanoType?.getValue(now),
          elevationM: p?.elevationM?.getValue(now),
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

const volcanoesLayer = createVolcanoesLayer();

export default volcanoesLayer;
