import * as Cesium from 'cesium';
import { mapIodaAlert, mapOoniAggregateRow } from './internetOutagesShape.js';

/**
 * Internet Outages & Censorship — CAIDA IODA outage alerts merged with OONI
 * censorship-measurement aggregates, by country.
 *
 * Fetched through the server-side `/api/internet-outages` proxy, never
 * directly from api.ioda.caida.org or api.ooni.io — same CORS-reliability
 * reasoning as `spaceWeatherProxy`'s doc comment in vite.config.js. The
 * proxy does the fetch, filter, and country-centroid join server-side (via
 * the SAME `mapIodaAlert`/`mapOoniAggregateRow` imported below — see
 * `internetOutagesShape.js`) and hands back a flat
 * `{ outages: [...], retrievedAt }` payload already in this layer's record
 * shape, mirroring the `globalHazards.js`/`globalHazardsShape.js` two-source
 * merge precedent.
 *
 * Neither IODA alerts nor OONI aggregates carry a coordinate of their own —
 * both key by country. `mapIodaAlert`/`mapOoniAggregateRow` join against a
 * bundled ISO-alpha-2 centroid table server-side, so what reaches this
 * layer already has a real lat/lon; a country with no bundled centroid
 * simply does not appear.
 *
 * IODA is a live outage SIGNAL (BGP visibility, active-probing reachability,
 * darknet traffic) — it does not distinguish a natural failure from a
 * deliberate one. OONI is a measured censorship SIGNAL (confirmed/anomalous
 * blocking of specific URLs/services) — it does not capture a wholesale
 * connectivity loss the same way IODA does. Rendered as two distinct kinds
 * on the same toggle so neither is mistaken for the other.
 */

const API_URL = '/api/internet-outages';

export const INTERNET_OUTAGES_OVERLAY_SOURCE_ID = 'internet-outages';

export { mapIodaAlert, mapOoniAggregateRow };

/** Point styling by severity band — Red is bigger/brighter, Orange smaller, mirroring the Global Hazards precedent. */
function severityStyle(severity) {
  if (severity === 'Red') return { color: Cesium.Color.fromCssColorString('#ff2d55'), pixelSize: 14 };
  return { color: Cesium.Color.fromCssColorString('#ff9838'), pixelSize: 9 };
}

/** Distinguishes an outage signal (IODA) from a censorship signal (OONI) at a glance. */
function sourceLabel(source) {
  return source === 'OONI' ? 'CENSORSHIP' : 'OUTAGE';
}

/**
 * Map one record's raw plain values (as pulled off an entity's `properties`,
 * or straight from the proxy payload) to a JSON-safe analyst record (analyst
 * query engine seam). Pure — no Cesium types. Missing/unknown fields are
 * null, never NaN/undefined. Falls back to an index-based id when the
 * upstream id is absent.
 * @param {Object|null|undefined} raw - Plain values:
 *   {id, source, countryCode, countryName, lat, lon, kind, severity, dateMs}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, source: string|null, countryCode: string|null,
 *   countryName: string|null, lat: number|null, lon: number|null,
 *   kind: string|null, severity: string|null, dateMs: number|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `OUTAGE-${String(index).padStart(4, '0')}`,
    source: text(raw?.source),
    countryCode: text(raw?.countryCode),
    countryName: text(raw?.countryName),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    kind: text(raw?.kind),
    severity: text(raw?.severity),
    dateMs: num(raw?.dateMs),
  };
}

export function createInternetOutagesLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;

  const layer = {
    id: 'internet-outages',
    name: 'Internet Outages & Censorship (IODA + OONI)',
    icon: '🌐',
    source: 'CAIDA IODA / OONI',
    updateInterval: 300000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('internet-outages');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:InternetOutages] Initialized');
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
          _lastError = `Internet Outages HTTP ${response.status}`;
          console.warn(`[Data:InternetOutages] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.outages)) {
          _lastError = 'Malformed internet outages response';
          return false;
        }

        _dataSource.entities.removeAll();
        let count = 0;

        for (const outage of payload.outages) {
          const lat = Number(outage?.lat);
          const lon = Number(outage?.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          count++;
          const style = severityStyle(outage.severity);
          const position = Cesium.Cartesian3.fromDegrees(lon, lat);
          const stableId = outage.id || `outage-${count}`;

          _dataSource.entities.add({
            id: `internet-outage:${stableId}`,
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
              text: `${outage.countryCode ?? ''} · ${sourceLabel(outage.source)}`,
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
              // Analyst seam (additive): the proxy-assigned outage id.
              outageId: outage.id ?? null,
              source: outage.source ?? null,
              countryCode: outage.countryCode ?? null,
              countryName: outage.countryName ?? null,
              kind: outage.kind ?? null,
              severity: outage.severity ?? null,
              dateMs: outage.dateMs ?? null,
            },
          });
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:InternetOutages] Updated: ${_count} signals`);
        return true;

      } catch (e) {
        console.warn('[Data:InternetOutages] Fetch error:', e);
        _lastError = 'Internet Outages network error';
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
     * Snapshot the layer's in-memory records as plain JSON-safe objects for
     * the analyst query engine. On-demand only (called at most once per
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
          id: p?.outageId?.getValue(now) ?? null,
          source: p?.source?.getValue(now),
          countryCode: p?.countryCode?.getValue(now),
          countryName: p?.countryName?.getValue(now),
          kind: p?.kind?.getValue(now),
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

const internetOutagesLayer = createInternetOutagesLayer();

export default internetOutagesLayer;
