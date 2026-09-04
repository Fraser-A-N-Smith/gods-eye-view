import * as Cesium from 'cesium';
import { mapSondeTelemetryFeed } from './sondehubShape.js';

/**
 * Radiosondes — live weather-balloon positions from the SondeHub Tracker
 * real-time feed, sitting between the surface-adjacent Live Flights layer
 * and the orbital Satellites layer: a genuinely different altitude band
 * (typically climbing to ~30 km before burst).
 *
 * Fetched through the server-side `/api/sondehub` proxy rather than directly
 * from `api.v2.sondehub.org`, so the client never hammers a community-funded
 * upstream on every poll and the 60s minimum-refresh guidance SondeHub asks
 * of consumers is enforced in one place. The pure mapping
 * (`mapSondeTelemetryFeed`) lives in the Cesium-free `sondehubShape.js`
 * (mirroring the existing `oceanBuoysShape.js`/`volcanoesShape.js`
 * precedent) and is imported directly below — this proxy and the browser
 * layer run the SAME implementation.
 *
 * Only currently-transmitting sondes appear (a sonde flies for roughly two
 * hours before landing), so the live worldwide count is normally small —
 * each renders as a small point sized/colored by altitude band, with a
 * label showing altitude in km.
 */

const API_URL = '/api/sondehub';

export { mapSondeTelemetryFeed };

/**
 * Style by altitude:
 *  - Ascent (< 15km): Cyan
 *  - Cruise (15-25km): Yellow
 *  - Near burst (>= 25km): Orange
 */
function altitudeStyle(altitudeM) {
  if (!Number.isFinite(altitudeM)) return { color: Cesium.Color.GRAY, pixelSize: 6 };
  if (altitudeM >= 25000) return { color: Cesium.Color.ORANGE, pixelSize: 10 };
  if (altitudeM >= 15000) return { color: Cesium.Color.YELLOW, pixelSize: 9 };
  return { color: Cesium.Color.CYAN, pixelSize: 8 };
}

/** Format altitude for the label, or a placeholder when unreported. */
function altitudeLabel(altitudeM) {
  return Number.isFinite(altitudeM) ? `${(altitudeM / 1000).toFixed(1)} km` : '-- km';
}

/**
 * Map one sonde's raw plain values (as pulled off an entity's `properties`,
 * or straight from the proxy payload) to a JSON-safe analyst record (analyst
 * query engine seam). Pure — no Cesium types. Missing/unknown fields are
 * null, never NaN/undefined. Falls back to an index-based id when the
 * upstream serial is absent.
 * @param {Object|null|undefined} raw - Plain values:
 *   {id, lat, lon, altitudeM, verticalSpeedMs, horizontalSpeedMs, headingDeg,
 *   tempC, launchSite}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, lat: number|null, lon: number|null,
 *   altitudeM: number|null, verticalSpeedMs: number|null,
 *   horizontalSpeedMs: number|null, headingDeg: number|null,
 *   tempC: number|null, launchSite: string|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `SONDE-${String(index).padStart(4, '0')}`,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    altitudeM: num(raw?.altitudeM),
    verticalSpeedMs: num(raw?.verticalSpeedMs),
    horizontalSpeedMs: num(raw?.horizontalSpeedMs),
    headingDeg: num(raw?.headingDeg),
    tempC: num(raw?.tempC),
    launchSite: text(raw?.launchSite),
  };
}

export function createSondehubLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;

  const layer = {
    id: 'sondehub',
    name: 'Radiosondes (SondeHub)',
    icon: '🎈',
    source: 'SondeHub Tracker',
    updateInterval: 90000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('sondehub');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:Sondehub] Initialized');
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
          _lastError = `Sondehub HTTP ${response.status}`;
          console.warn(`[Data:Sondehub] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.sondes)) {
          _lastError = 'Malformed sondehub response';
          return false;
        }

        _dataSource.entities.removeAll();
        let count = 0;

        for (const sonde of payload.sondes) {
          const lat = Number(sonde?.lat);
          const lon = Number(sonde?.lon);
          const altitudeM = Number.isFinite(sonde?.altitudeM) ? sonde.altitudeM : null;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const style = altitudeStyle(altitudeM);
          const position = Cesium.Cartesian3.fromDegrees(lon, lat, altitudeM ?? 0);
          const stableId = sonde.id || `sonde-${count}`;

          _dataSource.entities.add({
            id: `sonde:${stableId}`,
            position,
            point: {
              pixelSize: style.pixelSize,
              color: style.color,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: altitudeLabel(altitudeM),
              font: '12px sans-serif',
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -12),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              // Analyst seam (additive): the proxy-assigned sonde serial.
              sondeId: sonde.id ?? null,
              altitudeM,
              verticalSpeedMs: Number.isFinite(sonde.verticalSpeedMs) ? sonde.verticalSpeedMs : null,
              horizontalSpeedMs: Number.isFinite(sonde.horizontalSpeedMs) ? sonde.horizontalSpeedMs : null,
              headingDeg: Number.isFinite(sonde.headingDeg) ? sonde.headingDeg : null,
              tempC: Number.isFinite(sonde.tempC) ? sonde.tempC : null,
              launchSite: sonde.launchSite ?? null,
            },
          });
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Sondehub] Updated: ${_count} sondes`);
        return true;

      } catch (e) {
        console.warn('[Data:Sondehub] Fetch error:', e);
        _lastError = 'Sondehub network error';
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
     * Snapshot the layer's in-memory sonde records as plain JSON-safe
     * objects for the analyst query engine. On-demand only (called at most
     * once per spoken query) — zero per-frame cost, no listeners, no
     * caching. Returns [] while the layer is disabled or empty.
     * @param {number} [maxCount=500] - Maximum records to return (truncation).
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 500) {
      if (!_dataSource || !_dataSource.show) return [];
      const entities = _dataSource.entities.values;
      if (!entities.length) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 500;
      const now = Cesium.JulianDate.now();
      const result = [];
      for (const entity of entities) {
        if (result.length >= limit) break;
        const cartesian = entity.position ? entity.position.getValue(now) : null;
        const carto = cartesian ? Cesium.Cartographic.fromCartesian(cartesian) : null;
        const p = entity.properties;
        result.push(mapAnalystRecord({
          id: p?.sondeId?.getValue(now) ?? null,
          altitudeM: p?.altitudeM?.getValue(now),
          verticalSpeedMs: p?.verticalSpeedMs?.getValue(now),
          horizontalSpeedMs: p?.horizontalSpeedMs?.getValue(now),
          headingDeg: p?.headingDeg?.getValue(now),
          tempC: p?.tempC?.getValue(now),
          launchSite: p?.launchSite?.getValue(now),
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

const sondehubLayer = createSondehubLayer();

export default sondehubLayer;
