/**
 * @module data/weatherAlerts
 * @description Live NWS watches, warnings and advisories.
 *
 * The highest-volume authoritative event feed the app carries: every US
 * tornado warning, flash flood warning, winter storm warning and heat advisory
 * currently in force, as issued rather than inferred.
 *
 * ## The count on the chip is two numbers, and that is deliberate
 *
 * A large share of NWS alerts carry no polygon — they are issued against named
 * forecast zones, and the API returns a zone reference rather than a shape.
 * Those alerts cannot be drawn from this payload. They are still counted and
 * still listed, and the status line reports "N drawn · M zone-only", because a
 * map that quietly showed only the drawable ones would read as an all-clear
 * over places that are under a warning.
 *
 * Coverage is the United States and its territories. Everywhere else is
 * blank because this source does not cover it, which the status line says.
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import { severityStyle } from './weatherAlertsShape.js';

const API_URL = '/api/weather-alerts';
const UPDATE_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Honest one-line status for the layer chip.
 * @param {object} state Layer state.
 * @returns {string}
 */
export function alertsStatusText(state) {
  if (state.error) return state.error;
  if (state.loading) return 'LOADING ALERTS';
  if (state.count === 0) return 'NO ACTIVE ALERTS · US COVERAGE';
  const parts = [`${state.count} ACTIVE`];
  if (state.zoneOnly > 0) {
    // Never rounded away: these are in force but have no shape to draw.
    parts.push(`${state.drawable} DRAWN · ${state.zoneOnly} ZONE-ONLY`);
  }
  if (state.truncated && Number.isFinite(state.total)) {
    parts.push(`OF ${state.total} — MOST SEVERE SHOWN`);
  }
  parts.push('US COVERAGE');
  return parts.join(' · ');
}

export function createWeatherAlertsLayer({ fetchImpl = null } = {}) {
  let _dataSource = null;
  let _enabled = false;
  let _abort = null;
  const state = {
    count: 0,
    drawable: 0,
    zoneOnly: 0,
    total: null,
    truncated: false,
    loading: false,
    error: null,
    lastUpdate: null,
    alerts: [],
  };

  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  function draw() {
    if (!_dataSource) return;
    _dataSource.entities.removeAll();
    for (const alert of state.alerts) {
      if (!alert.drawable) continue;
      const style = severityStyle(alert.severity);
      const color = Cesium.Color.fromCssColorString(style.css);
      for (let index = 0; index < alert.rings.length; index += 1) {
        const positions = Cesium.Cartesian3.fromDegreesArray(alert.rings[index].flat());
        _dataSource.entities.add({
          id: `weather-alert-${alert.id}-${index}`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: color.withAlpha(0.18),
            outline: true,
            outlineColor: color.withAlpha(0.9),
            outlineWidth: 2,
            classificationType: Cesium.ClassificationType.BOTH,
          },
          properties: {
            kind: 'weather-alert',
            event: alert.event,
            severity: alert.severity,
            severityLabel: style.label,
            headline: alert.headline,
            areaDesc: alert.areaDesc,
            expires: alert.expires,
            sender: alert.sender,
          },
        });
      }
    }
    governorRequestRender('weather-alerts');
  }

  const layer = {
    id: 'weather-alerts',
    name: 'Weather Alerts',
    icon: '⚠️',
    source: 'NOAA NWS',
    updateInterval: UPDATE_INTERVAL_MS,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource('weather-alerts');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _enabled = false;
      console.log('[Data:WeatherAlerts] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      governorRequestRender('weather-alerts-enable');
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      if (_abort) {
        _abort.abort();
        _abort = null;
      }
      state.loading = false;
      governorRequestRender('weather-alerts-disable');
    },

    /** Hide during timeline replay — see the same hook on flights.js. */
    setReplaySuppressed(suppressed) {
      if (!_enabled || !_dataSource) return;
      _dataSource.show = !suppressed;
    },

    /**
     * Alerts that could not be drawn, so a UI can list what the map omits.
     * @returns {Array<object>}
     */
    getZoneOnlyAlerts() {
      return state.alerts.filter((alert) => !alert.drawable).map((alert) => ({
        id: alert.id,
        event: alert.event,
        severity: alert.severity,
        areaDesc: alert.areaDesc,
        expires: alert.expires,
      }));
    },

    async update() {
      if (!_enabled) return true;
      state.loading = true;
      _abort = new AbortController();
      try {
        const response = await doFetch(API_URL, { signal: _abort.signal });
        if (!response.ok) {
          state.error = `ALERT FEED HTTP ${response.status}`;
          return false;
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.alerts)) {
          state.error = 'MALFORMED ALERT RESPONSE';
          return false;
        }
        state.alerts = payload.alerts;
        state.count = payload.alerts.length;
        state.drawable = Number.isFinite(payload.drawable) ? payload.drawable : 0;
        state.zoneOnly = Number.isFinite(payload.zoneOnly) ? payload.zoneOnly : 0;
        state.truncated = payload.truncated === true;
        state.total = Number.isFinite(payload.total) ? payload.total : null;
        state.lastUpdate = Date.now();
        state.error = null;
        draw();
        console.log(`[Data:WeatherAlerts] ${state.count} active (${state.zoneOnly} zone-only)`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return true;
        state.error = 'ALERT FEED UNAVAILABLE';
        console.warn('[Data:WeatherAlerts] fetch error:', error);
        return false;
      } finally {
        state.loading = false;
        _abort = null;
      }
    },

    destroy(viewer) {
      _enabled = false;
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      state.alerts = [];
      state.count = 0;
      state.lastUpdate = null;
      state.error = null;
    },

    getStats() {
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        error: state.error,
        loading: state.loading,
        truncated: state.truncated,
        coverage: 'US NWS',
        status: alertsStatusText(state),
      };
    },
  };

  return layer;
}

const weatherAlertsLayer = createWeatherAlertsLayer();

export default weatherAlertsLayer;
