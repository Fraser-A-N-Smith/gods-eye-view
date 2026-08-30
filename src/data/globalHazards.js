import * as Cesium from 'cesium';

/**
 * Global Hazards — GDACS floods & droughts, merged with the NASA EONET
 * classes that no other layer already covers (severe storms, landslides,
 * sea/lake ice, temperature extremes, dust/haze, snow, water color).
 *
 * Fetched through the server-side `/api/global-hazards` proxy, never
 * directly from gdacs.org or eonet.gsfc.nasa.gov — neither upstream's CORS
 * posture is reliable for a direct browser fetch (same reasoning as
 * `spaceWeatherProxy`'s doc comment in vite.config.js). The proxy does the
 * GDACS/EONET fetch, filter, and merge and hands back a flat
 * `{ hazards: [...], retrievedAt }` payload already in this layer's record
 * shape, so `update()` below only needs to place points — it does not
 * re-run the filtering rules against raw upstream JSON.
 *
 * `mapGdacsFeature`/`mapEonetFeature` below are pure, exported copies of the
 * filter/mapping rules the proxy applies server-side (see
 * `mapGdacsFeatureServer`/`mapEonetFeatureServer` in vite.config.js). They
 * are NOT on the live data path — the browser always consumes the
 * already-merged proxy response — they exist so the filter CONTRACT (which
 * GDACS event types and EONET categories survive, and why) is unit-testable
 * from this file without importing the Node-only vite config, which would
 * also drag this module's `cesium` import into that process. Keep both
 * copies in sync by hand; `globalHazards.test.mjs` pins the exact rule set.
 *
 * Each hazard renders as a small colored point (not an ellipse — these are
 * discrete alert markers, not magnitude-scaled zones) with a `kind` label,
 * sized/colored by GDACS-style alert severity: Red is bigger and red,
 * Orange (including every EONET event, which carries no GDACS-style alert
 * level) is smaller and orange.
 */

const API_URL = '/api/global-hazards';

export const GLOBAL_HAZARDS_OVERLAY_SOURCE_ID = 'global-hazards';

/** GDACS `eventtype` codes kept here. EQ/TC/WF/VO all duplicate a dedicated layer. */
const GDACS_TYPES = new Set(['FL', 'DR']);

/** EONET `categories[0].id` values kept here. wildfires/volcanoes/earthquakes/floods all dup a dedicated layer. */
const EONET_CATEGORIES = new Set([
  'severeStorms', 'landslides', 'seaLakeIce', 'tempExtremes', 'dustHaze', 'snow', 'waterColor',
]);

/**
 * Map one raw GDACS GeoJSON feature to a normalized hazard record, or null
 * if the feature should be filtered out. Pure — see the module doc comment
 * for why this exists alongside the server-side `mapGdacsFeatureServer`.
 * @param {object} feature - A GDACS `geteventlist` GeoJSON feature.
 * @returns {{id:string, source:'GDACS', kind:string, title:string, lat:number,
 *   lon:number, severity:string, url:string|null, dateMs:number|null}|null}
 */
export function mapGdacsFeature(feature) {
  const p = feature?.properties;
  if (!p || !GDACS_TYPES.has(p.eventtype)) return null;
  if (p.iscurrent !== 'true' || p.alertlevel === 'Green') return null;
  const [lon, lat] = feature.geometry?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    id: `gdacs:${p.eventtype}:${p.eventid}`,
    source: 'GDACS',
    kind: p.eventtype,
    title: p.name || p.description || 'GDACS event',
    lat,
    lon,
    severity: p.alertlevel || 'Orange',
    url: p.url?.report || null,
    dateMs: Date.parse(p.datemodified || p.fromdate || '') || null,
  };
}

/**
 * Map one raw EONET event to a normalized hazard record, or null if the
 * event should be filtered out. Pure — takes the LAST geometry entry (EONET
 * events can carry a track of points over time; the most recent is current).
 * @param {object} event - A NASA EONET v3 event.
 * @returns {{id:string, source:'EONET', kind:string, title:string, lat:number,
 *   lon:number, severity:string, url:string|null, dateMs:number|null}|null}
 */
export function mapEonetFeature(event) {
  const categoryId = event?.categories?.[0]?.id;
  if (!categoryId || !EONET_CATEGORIES.has(categoryId)) return null;
  const geom = Array.isArray(event.geometry) ? event.geometry.at(-1) : null;
  const [lon, lat] = geom?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    id: `eonet:${event.id}`,
    source: 'EONET',
    kind: categoryId,
    title: event.title || 'EONET event',
    lat,
    lon,
    severity: 'Orange',
    url: event.link || null,
    dateMs: Date.parse(geom?.date || '') || null,
  };
}

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
        let count = 0;

        for (const hazard of payload.hazards) {
          const lat = Number(hazard?.lat);
          const lon = Number(hazard?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const style = severityStyle(hazard.severity);
          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          const stableId = hazard.id || `hazard-${count}`;

          _dataSource.entities.add({
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
        }

        _count = count;
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
      };
    },
  };
  return layer;
}

const globalHazardsLayer = createGlobalHazardsLayer();

export default globalHazardsLayer;
