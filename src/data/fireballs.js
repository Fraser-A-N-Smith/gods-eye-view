import * as Cesium from 'cesium';
import { mapFireballRow, mapFireballRows } from './fireballsShape.js';

/**
 * Fireballs — NASA/JPL Center for Near-Earth Object Studies (CNEOS) fireball
 * and bolide atmospheric detections, trailing 90 days.
 *
 * Fetched through the server-side `/api/fireballs` proxy, never directly
 * from ssd-api.jpl.nasa.gov — same reasoning as `spaceWeatherProxy`'s doc
 * comment in vite.config.js: the upstream response is a **fields+rows**
 * shape (`{fields: [...], data: [[...], ...]}`), not an array of objects, so
 * the proxy is where that gets zipped and normalized once instead of every
 * browser re-doing the same join. The mapping itself (`mapFireballRow`/
 * `mapFireballRows`) lives in the Cesium-free `fireballsShape.js` (mirroring
 * the existing `spaceWeatherShape.js`/`globalHazardsShape.js`/
 * `volcanoesShape.js`/`oceanBuoysShape.js`/`hamRadioPropagationShape.js`/
 * `criticalInfrastructureShape.js`/`borderWaitTimesShape.js` precedent) and
 * is imported directly below — this proxy and the browser layer run the SAME
 * mapping implementation, so there is nothing here to fall out of sync.
 * `fireballsShape.test.mjs` covers the mapping contract once.
 *
 * `mapFireballRow`/`mapFireballRows` are re-exported here (not merely
 * imported) so this module's public interface is unchanged from a straight
 * client-side mapper: they are pure and Cesium-free, they just happen to
 * live in `fireballsShape.js` precisely so `vite.config.js` can import the
 * SAME implementation the proxy actually runs without dragging this file's
 * `cesium` import into that Node-only process.
 *
 * Each fireball renders as a static bright point sized by radiated energy
 * (log scale — `sqrt(energyKt) * 20000`, mirroring earthquakes' `2^mag`
 * radius idea but for energy instead of magnitude), static geometry only (no
 * CallbackProperty, no continuous-render hold) — this is a small dataset
 * (CNEOS caps the feed at `limit=200`) polled on a 5-minute timer, not a
 * per-frame animator.
 */

const API_URL = '/api/fireballs';

export { mapFireballRow, mapFireballRows };

/** Point radius (meters) from radiated energy (kilotons), log-scaled. */
function energyRadius(energyKt) {
  const kt = Number.isFinite(energyKt) ? Math.max(energyKt, 0.01) : 0.01;
  return Math.sqrt(kt) * 20000;
}

/** Format the energy label, or a placeholder when unreported. */
function energyLabel(energyKt) {
  return Number.isFinite(energyKt) ? `${energyKt.toFixed(1)} kt` : '-- kt';
}

/**
 * Map one fireball's raw plain values (as pulled off an entity's
 * `properties`, or straight from the proxy payload) to a JSON-safe analyst
 * record (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id when
 * the upstream date/lat/lon composite id is absent.
 * @param {Object|null|undefined} raw - Plain values:
 *   {id, dateMs, energyKt, impactEnergyKt, lat, lon, altitudeKm, velocityKmS}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, dateMs: number|null, energyKt: number|null,
 *   impactEnergyKt: number|null, lat: number|null, lon: number|null,
 *   altitudeKm: number|null, velocityKmS: number|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `FIREBALL-${String(index).padStart(4, '0')}`,
    dateMs: num(raw?.dateMs),
    energyKt: num(raw?.energyKt),
    impactEnergyKt: num(raw?.impactEnergyKt),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    altitudeKm: num(raw?.altitudeKm),
    velocityKmS: num(raw?.velocityKmS),
  };
}

export function createFireballsLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;

  const layer = {
    id: 'fireballs',
    name: 'Fireballs (NASA/JPL CNEOS)',
    icon: '☄️',
    source: 'NASA/JPL Center for Near-Earth Object Studies',
    updateInterval: 300000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('fireballs');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:Fireballs] Initialized');
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
          _lastError = `Fireballs HTTP ${response.status}`;
          console.warn(`[Data:Fireballs] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.fireballs)) {
          _lastError = 'Malformed fireballs response';
          return false;
        }

        _dataSource.entities.removeAll();
        let count = 0;

        for (const fireball of payload.fireballs) {
          const lat = Number(fireball?.lat);
          const lon = Number(fireball?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const energyKt = Number.isFinite(fireball.energyKt) ? fireball.energyKt : null;
          const radius = energyRadius(energyKt);
          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          const stableId = fireball.id || `fireball-${count}`;

          _dataSource.entities.add({
            id: `fireball:${stableId}`,
            position,
            point: {
              pixelSize: Math.max(6, Math.min(24, Math.sqrt(radius / 1000))),
              color: Cesium.Color.fromCssColorString('#fff8c9'),
              outlineColor: Cesium.Color.YELLOW,
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: energyLabel(energyKt),
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
              // Analyst seam (additive): the proxy-assigned date/lat/lon id.
              fireballId: fireball.id ?? null,
              dateMs: Number.isFinite(fireball.dateMs) ? fireball.dateMs : null,
              energyKt,
              impactEnergyKt: Number.isFinite(fireball.impactEnergyKt) ? fireball.impactEnergyKt : null,
              altitudeKm: Number.isFinite(fireball.altitudeKm) ? fireball.altitudeKm : null,
              velocityKmS: Number.isFinite(fireball.velocityKmS) ? fireball.velocityKmS : null,
            },
          });
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Fireballs] Updated: ${_count} detections`);
        return true;

      } catch (e) {
        console.warn('[Data:Fireballs] Fetch error:', e);
        _lastError = 'Fireballs network error';
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
     * Snapshot the layer's in-memory fireball records as plain JSON-safe
     * objects for the analyst query engine. On-demand only (called at most
     * once per spoken query) — zero per-frame cost, no listeners, no
     * caching. Returns [] while the layer is disabled or empty.
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
          id: p?.fireballId?.getValue(now) ?? null,
          dateMs: p?.dateMs?.getValue(now),
          energyKt: p?.energyKt?.getValue(now),
          impactEnergyKt: p?.impactEnergyKt?.getValue(now),
          altitudeKm: p?.altitudeKm?.getValue(now),
          velocityKmS: p?.velocityKmS?.getValue(now),
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

const fireballsLayer = createFireballsLayer();

export default fireballsLayer;
