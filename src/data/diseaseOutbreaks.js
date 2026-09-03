import * as Cesium from 'cesium';
import { mapDiseaseOutbreakEntry } from './diseaseOutbreaksShape.js';

/**
 * Disease Outbreaks — WHO Disease Outbreak News (DON), the app's first
 * health/epidemiological event category.
 *
 * Fetched through the server-side `/api/disease-outbreaks` proxy, which
 * does the WHO fetch and country-centroid resolution (via the SAME
 * `mapDiseaseOutbreakEntry` imported below — see `diseaseOutbreaksShape.js`)
 * and hands back a flat `{ outbreaks: [...], retrievedAt }` payload already
 * in this layer's record shape.
 *
 * `mapDiseaseOutbreakEntry` is re-exported here (not merely imported) so
 * this module's public interface is unchanged: it is pure and Cesium-free,
 * living in `diseaseOutbreaksShape.js` precisely so `vite.config.js` can
 * import the SAME implementation the proxy actually runs, mirroring the
 * existing `volcanoesShape.js`/`oceanBuoysShape.js` precedent.
 *
 * WHO DON entries are sparse — typically a handful of new notices worldwide
 * per month — so `updateInterval` is a lazy hour, well above the proxy's
 * daily-ish server-side TTL. Each entry renders as a small point at its
 * country's approximate position (WHO reports at country granularity, not
 * lat/lon) with a title label, colored by recency.
 */

const API_URL = '/api/disease-outbreaks';

export { mapDiseaseOutbreakEntry };

/** Recency band, in days since publication — recent notices read hotter. */
function recencyStyle(publishedAt) {
  const ms = typeof publishedAt === 'string' ? Date.parse(publishedAt) : NaN;
  const ageDays = Number.isFinite(ms) ? (Date.now() - ms) / 86_400_000 : Infinity;
  if (ageDays <= 30) return { color: Cesium.Color.RED, pixelSize: 12 };
  if (ageDays <= 180) return { color: Cesium.Color.ORANGE, pixelSize: 10 };
  return { color: Cesium.Color.YELLOW, pixelSize: 8 };
}

/**
 * Map one outbreak's raw plain values (as pulled off an entity's
 * `properties`, or straight from the proxy payload) to a JSON-safe analyst
 * record (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the upstream id is absent.
 * @param {Object|null|undefined} raw - Plain values:
 *   {id, title, country, lat, lon, publishedAt, url}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, title: string|null, country: string|null,
 *   lat: number|null, lon: number|null, publishedAt: string|null, url: string|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `OUTBREAK-${String(index).padStart(4, '0')}`,
    title: text(raw?.title),
    country: text(raw?.country),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    publishedAt: text(raw?.publishedAt),
    url: text(raw?.url),
  };
}

export function createDiseaseOutbreaksLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;

  const layer = {
    id: 'disease-outbreaks',
    name: 'Disease Outbreaks (WHO)',
    icon: '🦠',
    source: 'World Health Organization — Disease Outbreak News',
    updateInterval: 3600000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('disease-outbreaks');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:DiseaseOutbreaks] Initialized');
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
          _lastError = `Disease Outbreaks HTTP ${response.status}`;
          console.warn(`[Data:DiseaseOutbreaks] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.outbreaks)) {
          _lastError = 'Malformed disease outbreaks response';
          return false;
        }

        _dataSource.entities.removeAll();
        let count = 0;

        for (const outbreak of payload.outbreaks) {
          const lat = Number(outbreak?.lat);
          const lon = Number(outbreak?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const style = recencyStyle(outbreak.publishedAt);
          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          const stableId = outbreak.id || `outbreak-${count}`;

          _dataSource.entities.add({
            id: `outbreak:${stableId}`,
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
              text: String(outbreak.title ?? ''),
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
              // Analyst seam (additive): the proxy-assigned outbreak id.
              outbreakId: outbreak.id ?? null,
              title: outbreak.title ?? null,
              country: outbreak.country ?? null,
              publishedAt: outbreak.publishedAt ?? null,
              url: outbreak.url ?? null,
            },
          });
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:DiseaseOutbreaks] Updated: ${_count} notices`);
        return true;

      } catch (e) {
        console.warn('[Data:DiseaseOutbreaks] Fetch error:', e);
        _lastError = 'Disease outbreaks network error';
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
    },

    /**
     * Snapshot the layer's in-memory outbreak records as plain JSON-safe
     * objects for the analyst query engine. On-demand only (called at most
     * once per spoken query) — zero per-frame cost, no listeners, no
     * caching. Returns [] while the layer is disabled or empty.
     * @param {number} [maxCount=200] - Maximum records to return (truncation).
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 200) {
      if (!_dataSource || !_dataSource.show) return [];
      const entities = _dataSource.entities.values;
      if (!entities.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 200;
      const now = Cesium.JulianDate.now();
      const result = [];
      for (const entity of entities) {
        if (result.length >= limit) break;
        const cartesian = entity.position ? entity.position.getValue(now) : null;
        const carto = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
        const p = entity.properties;
        result.push(mapAnalystRecord({
          id: p?.outbreakId?.getValue(now) ?? null,
          title: p?.title?.getValue(now),
          country: p?.country?.getValue(now),
          publishedAt: p?.publishedAt?.getValue(now),
          url: p?.url?.getValue(now),
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
      };
    },
  };
  return layer;
}

const diseaseOutbreaksLayer = createDiseaseOutbreaksLayer();

export default diseaseOutbreaksLayer;
