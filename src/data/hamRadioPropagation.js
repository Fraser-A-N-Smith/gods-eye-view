import * as Cesium from 'cesium';
import { maidenheadToLatLon, parsePskReporterXml } from './hamRadioPropagationShape.js';

/**
 * Ham Radio Propagation — PSKReporter.info amateur radio reception reports
 * (FT8, trailing 15 minutes), roughly 200 recent spots worldwide.
 *
 * Fetched through the server-side `/api/ham-radio` proxy, never directly
 * from retrieve.pskreporter.info — the upstream is XML (not JSON), and
 * station locations are Maidenhead grid squares that need decoding to
 * lat/lon (same reasoning as `spaceWeatherProxy`'s doc comment in
 * vite.config.js: server-side parsing means the browser never downloads or
 * re-parses the raw feed, and never re-decodes a grid square the proxy
 * already decoded). The XML parser and grid decoder
 * (`parsePskReporterXml`/`maidenheadToLatLon`) live in the Cesium-free
 * `hamRadioPropagationShape.js` (mirroring the existing
 * `spaceWeatherShape.js`/`globalHazardsShape.js`/`volcanoesShape.js`/
 * `oceanBuoysShape.js` precedent) and are imported directly below — this
 * proxy and the browser layer run the SAME parsing implementation, so there
 * is nothing here to fall out of sync. `hamRadioPropagationShape.test.mjs`
 * covers the parser/decoder contract once.
 *
 * `maidenheadToLatLon`/`parsePskReporterXml` are re-exported here (not merely
 * imported) so this module's public interface is unchanged from a
 * straight client-side parser: they are pure and Cesium-free, they just
 * happen to live in `hamRadioPropagationShape.js` precisely so
 * `vite.config.js` can import the SAME implementation the proxy actually
 * runs without dragging this file's `cesium` import into that Node-only
 * process.
 *
 * Each spot renders as a polyline arc between the sender and receiver
 * stations, colored/brightened by SNR. PSKReporter's developer page
 * explicitly asks for no more than one poll every 5 minutes —
 * `updateInterval: 300000` below is a hard requirement, not just a nicety,
 * and the proxy's own cache TTL matches it so the two stay in lockstep no
 * matter how many browser tabs are open.
 *
 * Polyline `positions` are a STATIC plain array of two `Cartesian3`s,
 * rebuilt only when a poll brings new data — never a `CallbackProperty` —
 * and the layer never holds the render governor continuous: there is no
 * per-frame animator here for it to keep the render loop alive for.
 */

const API_URL = '/api/ham-radio';

export { maidenheadToLatLon, parsePskReporterXml };

/**
 * Style by SNR (signal-to-noise ratio, dB) — higher SNR renders brighter and
 * thicker, since a stronger decode reflects a cleaner path worth more visual
 * weight. PSKReporter FT8 spots span roughly -24..+20 dB; values outside
 * that range are clamped rather than pinned off-scale.
 */
function snrStyle(snr) {
  const clamped = Number.isFinite(snr) ? Math.max(-24, Math.min(20, snr)) : -24;
  const t = (clamped + 24) / 44; // 0..1
  return {
    color: Cesium.Color.CYAN.withAlpha(0.2 + t * 0.7),
    width: 1 + t * 2,
  };
}

/**
 * Map one PSKReporter spot's raw plain values (as pulled off an entity's
 * `properties`, or straight from the proxy payload) to a JSON-safe analyst
 * record (analyst query engine seam). Pure — no Cesium types. Missing/unknown
 * fields are null, never NaN/undefined. Falls back to an index-based id
 * when the upstream spot id is absent.
 * @param {Object|null|undefined} raw - Plain values: {id, senderCallsign,
 *   receiverCallsign, senderLat, senderLon, receiverLat, receiverLon,
 *   frequencyHz, mode, snr}.
 * @param {number} [index=0] - Position in the snapshot (fallback id only).
 * @returns {{id: string, senderCallsign: string|null, receiverCallsign: string|null,
 *   senderLat: number|null, senderLon: number|null, receiverLat: number|null,
 *   receiverLon: number|null, frequencyHz: number|null, mode: string|null,
 *   snr: number|null}}
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => { const t = String(v ?? '').trim(); return t || null; };
  return {
    id: text(raw?.id) || `SPOT-${String(index).padStart(4, '0')}`,
    senderCallsign: text(raw?.senderCallsign),
    receiverCallsign: text(raw?.receiverCallsign),
    senderLat: num(raw?.senderLat),
    senderLon: num(raw?.senderLon),
    receiverLat: num(raw?.receiverLat),
    receiverLon: num(raw?.receiverLon),
    frequencyHz: num(raw?.frequencyHz),
    mode: text(raw?.mode),
    snr: num(raw?.snr),
  };
}

export function createHamRadioPropagationLayer() {
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;

  const layer = {
    id: 'ham-radio-propagation',
    name: 'Ham Radio Propagation (PSKReporter)',
    icon: '📡',
    source: 'PSKReporter.info',
    updateInterval: 300000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('ham-radio-propagation');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:HamRadioPropagation] Initialized');
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
          _lastError = `Ham Radio HTTP ${response.status}`;
          console.warn(`[Data:HamRadioPropagation] API returned ${response.status}`);
          return false;
        }

        const payload = await response.json();
        if (!payload || !Array.isArray(payload.spots)) {
          _lastError = 'Malformed ham radio response';
          return false;
        }

        _dataSource.entities.removeAll();
        let count = 0;

        for (const spot of payload.spots) {
          const senderLat = Number(spot?.senderLat);
          const senderLon = Number(spot?.senderLon);
          const receiverLat = Number(spot?.receiverLat);
          const receiverLon = Number(spot?.receiverLon);
          if (!Number.isFinite(senderLat) || !Number.isFinite(senderLon)
              || !Number.isFinite(receiverLat) || !Number.isFinite(receiverLon)) continue;

          count++;
          const snr = Number.isFinite(spot.snr) ? spot.snr : null;
          const style = snrStyle(snr);
          const senderPos = Cesium.Cartesian3.fromDegrees(senderLon, senderLat);
          const receiverPos = Cesium.Cartesian3.fromDegrees(receiverLon, receiverLat);
          const stableId = spot.id || `spot-${count}`;

          _dataSource.entities.add({
            id: `ham-radio:${stableId}`,
            polyline: {
              // Static positions — see the module header. This is an arc
              // between two stations, redrawn only when a poll brings new
              // data, never a per-frame CallbackProperty.
              positions: [senderPos, receiverPos],
              width: style.width,
              material: new Cesium.ColorMaterialProperty(style.color),
            },
            properties: {
              // Analyst seam (additive): the proxy-assigned spot id.
              spotId: spot.id ?? null,
              senderCallsign: spot.senderCallsign ?? null,
              receiverCallsign: spot.receiverCallsign ?? null,
              senderLat,
              senderLon,
              receiverLat,
              receiverLon,
              frequencyHz: Number.isFinite(spot.frequencyHz) ? spot.frequencyHz : null,
              mode: spot.mode ?? null,
              snr,
            },
          });
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:HamRadioPropagation] Updated: ${_count} spots`);
        return true;

      } catch (e) {
        console.warn('[Data:HamRadioPropagation] Fetch error:', e);
        _lastError = 'Ham radio network error';
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
     * Snapshot the layer's in-memory spot records as plain JSON-safe objects
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
        const p = entity.properties;
        result.push(mapAnalystRecord({
          id: p?.spotId?.getValue(now) ?? null,
          senderCallsign: p?.senderCallsign?.getValue(now),
          receiverCallsign: p?.receiverCallsign?.getValue(now),
          senderLat: p?.senderLat?.getValue(now),
          senderLon: p?.senderLon?.getValue(now),
          receiverLat: p?.receiverLat?.getValue(now),
          receiverLon: p?.receiverLon?.getValue(now),
          frequencyHz: p?.frequencyHz?.getValue(now),
          mode: p?.mode?.getValue(now),
          snr: p?.snr?.getValue(now),
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

const hamRadioPropagationLayer = createHamRadioPropagationLayer();

export default hamRadioPropagationLayer;
