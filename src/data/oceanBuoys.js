import * as Cesium from 'cesium';
import { parseNdbcLine, parseNdbcText } from './oceanBuoysShape.js';
import { addUniqueEntity } from './entityDedupe.js';

/**
 * Ocean Buoys — NOAA National Data Buoy Center (NDBC) `latest_obs.txt`,
 * roughly 800 buoy and coastal stations worldwide.
 *
 * Fetched through the server-side `/api/ocean-buoys` proxy, never directly
 * from ndbc.noaa.gov — the upstream is plain fixed-width text, not JSON, and
 * this proxy is where that gets parsed once (same reasoning as
 * `spaceWeatherProxy`'s doc comment in vite.config.js: server-side parsing
 * means the browser never downloads or re-parses the raw feed). The fixed-
 * width parser itself (`parseNdbcLine`/`parseNdbcText`) lives in the
 * Cesium-free `oceanBuoysShape.js` (mirroring the existing
 * `spaceWeatherShape.js`/`globalHazardsShape.js`/`volcanoesShape.js`
 * precedent) and is imported directly below — this proxy and the browser
 * layer run the SAME parsing implementation, so there is nothing here to
 * fall out of sync. `oceanBuoysShape.test.mjs` covers the parser contract
 * once.
 *
 * `parseNdbcLine`/`parseNdbcText` are re-exported here (not merely
 * imported) so this module's public interface is unchanged from a straight
 * client-side parser: they are pure and Cesium-free, they just happen to
 * live in `oceanBuoysShape.js` precisely so `vite.config.js` can import the
 * SAME implementation the proxy actually runs without dragging this file's
 * `cesium` import into that Node-only process.
 *
 * Each NDBC buoy renders as a small colored point sized/colored by wave
 * height — or gray if the buoy reports no wave-height reading at all, since
 * an instrument with nothing to say should not visually read as "calm
 * seas" — with a label showing wind speed.
 *
 * The proxy also merges in a curated set of NOAA CO-OPS tide stations (see
 * `oceanBuoysShape.js`'s `mapCoOpsStation` doc comment for why that set is
 * curated rather than a live bulk feed like NDBC's). Those render with a
 * fixed distinct color (`stationType: 'co-ops-tide'`) and a water-level
 * label instead of wave height/wind — a different measurement, not a
 * missing one.
 */

const API_URL = '/api/ocean-buoys';

export { parseNdbcLine, parseNdbcText };

/**
 * Style by significant wave height:
 *  - No reading (null): Gray — the buoy has nothing to say, not "calm".
 *  - Calm (< 1m): Cyan
 *  - Moderate (1-2m): Yellow
 *  - Rough (2-4m): Orange
 *  - High (>= 4m): Red
 */
function waveStyle(waveHeightM) {
  if (waveHeightM === null || !Number.isFinite(waveHeightM)) {
    return { color: Cesium.Color.GRAY, pixelSize: 6 };
  }
  if (waveHeightM >= 4) return { color: Cesium.Color.RED, pixelSize: 14 };
  if (waveHeightM >= 2) return { color: Cesium.Color.ORANGE, pixelSize: 12 };
  if (waveHeightM >= 1) return { color: Cesium.Color.YELLOW, pixelSize: 10 };
  return { color: Cesium.Color.CYAN, pixelSize: 8 };
}

/** CO-OPS tide stations get a fixed, distinct color — water level is not a wave-height reading. */
function tideStyle() {
  return { color: Cesium.Color.DODGERBLUE, pixelSize: 8 };
}

/** Format wind speed for the label, or a placeholder when unreported. */
function windLabel(windSpeedMs) {
  return Number.isFinite(windSpeedMs) ? `${windSpeedMs.toFixed(1)} m/s` : '-- m/s';
}

/** Format water level for the label, or a placeholder when unreported. */
function waterLevelLabel(waterLevelM) {
  return Number.isFinite(waterLevelM) ? `${waterLevelM.toFixed(2)} m` : '-- m';
}

/**
 * Map one buoy's raw plain values (as pulled off an entity's `properties`,
 * or straight from the proxy payload) to a JSON-safe analyst record (analyst
 * query engine seam). Pure — no Cesium types. Missing/unknown fields are
 * null, never NaN/undefined. Falls back to an index-based id when the
 * upstream station id is absent.
 * @param {Object|null|undefined} raw - Plain values:
 *   {id, lat, lon, windSpeedMs, waveHeightM, airTempC, waterTempC,
 *   stationType, waterLevelM}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, lat: number|null, lon: number|null,
 *   windSpeedMs: number|null, waveHeightM: number|null,
 *   airTempC: number|null, waterTempC: number|null,
 *   stationType: string, waterLevelM: number|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `BUOY-${String(index).padStart(4, '0')}`,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    windSpeedMs: num(raw?.windSpeedMs),
    waveHeightM: num(raw?.waveHeightM),
    airTempC: num(raw?.airTempC),
    waterTempC: num(raw?.waterTempC),
    stationType: text(raw?.stationType) || 'ndbc-buoy',
    waterLevelM: num(raw?.waterLevelM),
  };
}

export function createOceanBuoysLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _duplicatesSkipped = 0;

  const layer = {
    id: 'ocean-buoys',
    name: 'Ocean Buoys (NOAA NDBC)',
    icon: '🛟',
    source: 'NOAA National Data Buoy Center',
    updateInterval: 300000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('ocean-buoys');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:OceanBuoys] Initialized');
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
          _lastError = `Ocean Buoys HTTP ${response.status}`;
          console.warn(`[Data:OceanBuoys] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.buoys)) {
          _lastError = 'Malformed ocean buoys response';
          return false;
        }

        _dataSource.entities.removeAll();
        const seenIds = new Set();
        let count = 0;
        let skipped = 0;

        for (const buoy of payload.buoys) {
          const lat = Number(buoy?.lat);
          const lon = Number(buoy?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const isTideStation = buoy.stationType === 'co-ops-tide';
          const waveHeightM = Number.isFinite(buoy.waveHeightM) ? buoy.waveHeightM : null;
          const windSpeedMs = Number.isFinite(buoy.windSpeedMs) ? buoy.windSpeedMs : null;
          const waterLevelM = Number.isFinite(buoy.waterLevelM) ? buoy.waterLevelM : null;
          const style = isTideStation ? tideStyle() : waveStyle(waveHeightM);
          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          const stableId = buoy.id || `buoy-${count}`;

          const added = addUniqueEntity(_dataSource.entities, seenIds, {
            id: `buoy:${stableId}`,
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
              text: isTideStation ? waterLevelLabel(waterLevelM) : windLabel(windSpeedMs),
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
              // Analyst seam (additive): the proxy-assigned buoy/station id.
              buoyId: buoy.id ?? null,
              windSpeedMs,
              waveHeightM,
              airTempC: Number.isFinite(buoy.airTempC) ? buoy.airTempC : null,
              waterTempC: Number.isFinite(buoy.waterTempC) ? buoy.waterTempC : null,
              stationType: buoy.stationType || 'ndbc-buoy',
              waterLevelM,
            },
          });
          if (!added) skipped++;
        }

        _count = count - skipped;
        _duplicatesSkipped = skipped;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:OceanBuoys] Updated: ${_count} buoys`);
        return true;

      } catch (e) {
        console.warn('[Data:OceanBuoys] Fetch error:', e);
        _lastError = 'Ocean buoys network error';
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
     * Snapshot the layer's in-memory buoy records as plain JSON-safe objects
     * for the analyst query engine. On-demand only (called at most once per
     * spoken query) — zero per-frame cost, no listeners, no caching. Returns
     * [] while the layer is disabled or empty.
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
          id: p?.buoyId?.getValue(now) ?? null,
          windSpeedMs: p?.windSpeedMs?.getValue(now),
          waveHeightM: p?.waveHeightM?.getValue(now),
          airTempC: p?.airTempC?.getValue(now),
          waterTempC: p?.waterTempC?.getValue(now),
          stationType: p?.stationType?.getValue(now),
          waterLevelM: p?.waterLevelM?.getValue(now),
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

const oceanBuoysLayer = createOceanBuoysLayer();

export default oceanBuoysLayer;
