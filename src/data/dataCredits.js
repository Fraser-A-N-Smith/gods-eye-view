import * as Cesium from 'cesium';

/**
 * Per-layer data attribution registered into Cesium's credit display.
 *
 * Legal requirement (see DATA_SOURCES.md, findings H10/H11 in
 * every third-party data layer this app can
 * display carries its own license and required attribution — ODbL (OSM
 * datacenters/dams, adsb.lol, Overpass roads), CC BY-NC-SA (TeleGeography
 * cables), NASA FIRMS, CelesTrak, USGS, City of Austin, GBFS operators, OpenSky.
 * The MIT code license does NOT cover this data.
 *
 * These credits are registered ONCE at init as STATIC credits with
 * showOnScreen=false, so they live in the expandable bottom-left "Data
 * attribution" lightbox (Cesium's credit popover) rather than cluttering the
 * on-globe line. Always-present is intentional and reversible: the lightbox is
 * the app's canonical attribution surface and DATA_SOURCES.md is the
 * machine-readable index. Strings are copied verbatim from DATA_SOURCES.md — if
 * you add a data source, add it there AND here.
 */

/**
 * Attribution entries. `html` is the credit markup; keep it minimal and
 * link out where DATA_SOURCES.md provides a canonical URL. Order roughly
 * follows DATA_SOURCES.md (live sources, then bundled snapshots).
 * @type {{ key: string, html: string }[]}
 */
export const DATA_CREDITS = [
  // ── Live sources ────────────────────────────────────────────────
  {
    key: 'opensky',
    html:
      'Flights: OpenSky Network — Schäfer et al., ' +
      '“Bringing Up OpenSky”, IPSN 2014 · ' +
      '<a href="https://opensky-network.org" target="_blank" rel="noopener">opensky-network.org</a> ' +
      '(non-commercial)',
  },
  {
    key: 'adsblol',
    html:
      'Military flights, aircraft traces &amp; bounded regional flight fallback: ' +
      '<a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'aisstream',
    html:
      'Live vessels (AIS): ' +
      '<a href="https://aisstream.io" target="_blank" rel="noopener">AISStream.io</a>',
  },
  {
    key: 'celestrak',
    html:
      'Satellites (TLEs): CelesTrak ' +
      '(<a href="https://celestrak.org" target="_blank" rel="noopener">celestrak.org</a>), ' +
      'Dr. T.S. Kelso',
  },
  {
    key: 'open-notify',
    html:
      'ISS crew roster: ' +
      '<a href="http://open-notify.org" target="_blank" rel="noopener">Open Notify</a>',
  },
  {
    key: 'launch-library-2',
    html:
      'Space mission launch, payload &amp; recovery metadata: ' +
      '<a href="https://ll.thespacedevs.com/docs/" target="_blank" rel="noopener">Launch Library 2 — The Space Devs</a> ' +
      '(API documentation and rate limits)',
  },
  {
    key: 'usgs',
    html: 'Earthquakes: Data courtesy of the U.S. Geological Survey',
  },
  {
    key: 'overpass',
    html:
      'Road geometry (traffic): ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'military-installations-osm',
    html:
      'Mapped installation context: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0; incomplete mapped context)',
  },
  {
    key: 'cockpit-place-osm',
    html:
      'Cockpit place context: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      'via Nominatim (ODbL 1.0)',
  },
  {
    key: 'open-meteo',
    html:
      'Cockpit current conditions: ' +
      '<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> ' +
      '(CC BY 4.0)',
  },
  {
    key: 'google-news-rss',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://policies.google.com/terms" target="_blank" rel="noopener">Google News RSS</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'gdelt',
    html:
      'Cockpit regional headlines: ' +
      '<a href="https://www.gdeltproject.org/about.html" target="_blank" rel="noopener">GDELT Project</a> ' +
      '(location-matched article links; publisher terms apply)',
  },
  {
    key: 'reliefweb',
    html:
      'Cockpit humanitarian-response context: ' +
      '<a href="https://reliefweb.int" target="_blank" rel="noopener">ReliefWeb (UN OCHA)</a> ' +
      '(country-matched report links; publisher terms apply)',
  },
  {
    key: 'gdelt-cameo-events',
    html:
      'Geopolitical Events (CAMEO-typed, rolling buffer): ' +
      '<a href="https://www.gdeltproject.org/about.html" target="_blank" rel="noopener">GDELT Project — Event Database 2.0</a> ' +
      '(reported events, not confirmed incidents)',
  },
  {
    key: 'gdacs',
    html:
      'Global hazard alerts (floods, droughts): ' +
      '<a href="https://www.gdacs.org" target="_blank" rel="noopener">GDACS — Global Disaster Alert and Coordination System</a>',
  },
  {
    key: 'eonet',
    html:
      'Global hazard events (severe storms, landslides, sea ice, temperature extremes): ' +
      '<a href="https://eonet.gsfc.nasa.gov" target="_blank" rel="noopener">NASA EONET</a>',
  },
  {
    key: 'gvp',
    html:
      'Volcano data: Global Volcanism Program, Smithsonian Institution — ' +
      '<a href="https://volcano.si.edu" target="_blank" rel="noopener">volcano.si.edu</a>',
  },
  {
    key: 'ndbc',
    html:
      'Ocean buoy observations: NOAA National Data Buoy Center — ' +
      '<a href="https://www.ndbc.noaa.gov" target="_blank" rel="noopener">ndbc.noaa.gov</a> ' +
      '(US public domain)',
  },
  {
    key: 'pskreporter',
    html:
      'Amateur radio propagation spots: ' +
      '<a href="https://pskreporter.info" target="_blank" rel="noopener">PSKReporter.info</a>',
  },
  {
    key: 'cbp-bwt',
    html:
      'Land border crossing wait times: U.S. Customs and Border Protection — ' +
      '<a href="https://bwt.cbp.gov" target="_blank" rel="noopener">Border Wait Times</a> ' +
      '(US public domain; major crossings only)',
  },
  {
    key: 'cneos-fireball',
    html:
      'Fireball/bolide detections: ' +
      '<a href="https://cneos.jpl.nasa.gov/fireballs/" target="_blank" rel="noopener">NASA/JPL CNEOS Fireball Data API</a> ' +
      '(US public domain)',
  },
  {
    key: 'donki',
    html:
      'Solar event notifications (CMEs, flares): ' +
      '<a href="https://ccmc.gsfc.nasa.gov/tools/DONKI/" target="_blank" rel="noopener">NASA DONKI</a>',
  },
  {
    key: 'neows',
    html:
      'Near-Earth object close approaches: ' +
      '<a href="https://api.nasa.gov/" target="_blank" rel="noopener">NASA NeoWs — Near Earth Object Web Service</a>',
  },
  {
    key: 'austin-cctv',
    html:
      'CCTV cameras &amp; frames: City of Austin, TX — ' +
      '<a href="https://data.austintexas.gov" target="_blank" rel="noopener">data.austintexas.gov</a>',
  },
  {
    key: 'caltrans-cctv',
    html:
      'CCTV cameras &amp; frames (California): Caltrans — ' +
      '<a href="https://cwwp2.dot.ca.gov/" target="_blank" rel="noopener">cwwp2.dot.ca.gov</a>',
  },
  {
    key: 'tfl-cctv',
    html:
      'CCTV cameras &amp; frames (London): ' +
      '<a href="https://tfl.gov.uk/info-for/open-data-users/" target="_blank" rel="noopener">Powered by TfL Open Data</a>. ' +
      'Contains OS data © Crown copyright and database rights.',
  },
  {
    key: 'gbfs',
    html: 'Bikeshare availability: GBFS operator feeds (e.g. Austin BCycle)',
  },
  {
    key: 'radio-browser',
    html:
      'Internet-radio station directory: ' +
      '<a href="https://www.radio-browser.info/" target="_blank" rel="noopener">Radio Browser</a> ' +
      '(public domain; audio delivered directly by each broadcaster)',
  },
  {
    key: 'reearth-terrain',
    html:
      'Terrain (keyless globe stacks): ' +
      '<a href="https://terrain.reearth.land" target="_blank" rel="noopener">Re:Earth Terrain</a> / ' +
      'Mapterhorn (CC BY 4.0) / EGM2008 (NGA)',
  },
  // ── Bundled snapshots ───────────────────────────────────────────
  {
    key: 'datacenters',
    html:
      'Datacenters: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0)',
  },
  {
    key: 'dams',
    html:
      'Dams: ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> ' +
      '(ODbL 1.0) + Open Infrastructure Map',
  },
  {
    key: 'firms',
    html:
      'Active fires: NASA FIRMS — we acknowledge the use of data and/or imagery ' +
      'from NASA’s Fire Information for Resource Management System ' +
      '(<a href="https://earthdata.nasa.gov/firms" target="_blank" rel="noopener">earthdata.nasa.gov/firms</a>), ' +
      'part of NASA’s Earth Observing System Data and Information System (EOSDIS)',
  },
  {
    key: 'rainviewer',
    html:
      'Weather radar &amp; infrared satellite overlays: ' +
      '<a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a> ' +
      '(free public API — non-commercial and small-scale use)',
  },
  {
    key: 'openseamap',
    html:
      'Sea marks (buoys, beacons, lighthouses, harbours): ' +
      '<a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a> ' +
      'contributors (ODbL 1.0)',
  },
  {
    key: 'opensnowmap',
    html:
      'Ski pistes, lifts and nordic trails: ' +
      '<a href="https://www.opensnowmap.org" target="_blank" rel="noopener">OpenSnowMap.org</a> ' +
      '&amp; © OpenStreetMap contributors (ODbL 1.0)',
  },
  {
    key: 'openrailwaymap',
    html:
      'Rail network overlay (tracks, stations, electrification): ' +
      '<a href="https://www.openrailwaymap.org" target="_blank" rel="noopener">OpenRailwayMap</a> ' +
      '&amp; © OpenStreetMap contributors (ODbL 1.0)',
  },
  {
    key: 'noaa-nws',
    html:
      'Weather alerts &amp; tropical cyclones: NOAA National Weather Service and ' +
      'National Hurricane Center (' +
      '<a href="https://www.weather.gov" target="_blank" rel="noopener">weather.gov</a>' +
      ', US public domain)',
  },
  {
    key: 'noaa-swpc',
    html:
      'Space weather (aurora forecast, planetary K-index): NOAA / NWS Space Weather ' +
      'Prediction Center (' +
      '<a href="https://www.swpc.noaa.gov" target="_blank" rel="noopener">swpc.noaa.gov</a>' +
      ', US public domain)',
  },
  {
    key: 'copernicus',
    html:
      'Sentinel-1 SAR &amp; Sentinel-2 optical imagery: Contains modified Copernicus ' +
      'Sentinel data — European Space Agency / ' +
      '<a href="https://dataspace.copernicus.eu" target="_blank" rel="noopener">Copernicus Data Space</a>',
  },
  {
    key: 'gfw',
    html:
      'Vessel events (AIS gaps, encounters, loitering, port visits): ' +
      '<a href="https://globalfishingwatch.org" target="_blank" rel="noopener">Global Fishing Watch</a> ' +
      '(CC BY-NC 4.0 — <strong>non-commercial use only</strong>)',
  },
  {
    key: 'acled',
    html:
      'ACLED Events (battles, violence against civilians, riots, protests, explosions/remote violence, ' +
      'strategic developments): ' +
      '<a href="https://acleddata.com" target="_blank" rel="noopener">ACLED</a> ' +
      '(<strong>non-commercial use only</strong> — see DATA_SOURCES.md)',
  },
  {
    key: 'nifc',
    html:
      'Wildfire perimeters: National Interagency Fire Center — WFIGS Interagency ' +
      'Wildland Fire Perimeters (' +
      '<a href="https://data-nifc.opendata.arcgis.com" target="_blank" rel="noopener">data-nifc.opendata.arcgis.com</a>' +
      ', public domain)',
  },
  {
    key: 'gibs',
    html:
      'Satellite imagery basemaps: NASA EOSDIS Global Imagery Browse Services ' +
      '(GIBS) / Worldview — ' +
      '<a href="https://worldview.earthdata.nasa.gov" target="_blank" rel="noopener">worldview.earthdata.nasa.gov</a>',
  },
  {
    key: 'telegeography',
    html:
      'Submarine cables: © TeleGeography — ' +
      '<a href="https://www.submarinecablemap.com" target="_blank" rel="noopener">submarinecablemap.com</a> ' +
      '(CC BY-NC-SA 3.0 — NonCommercial)',
  },
];

/**
 * Conditional credits — registered via `registerDynamicCredit` only when the
 * corresponding capability actually activates (deliberately NOT part of
 * DATA_CREDITS, which is always-on). TomTom terms require attribution when
 * their flow data is displayed; keyless installs never show it, so the
 * credit only appears once live traffic-flow mode activates.
 * @type {{ key: string, html: string }}
 */
export const TOMTOM_CREDIT = {
  key: 'tomtom',
  html:
    'Traffic flow data © ' +
    '<a href="https://www.tomtom.com" target="_blank" rel="noopener">TomTom</a>',
};

/** Registered when the first Natural Earth region outline resolves (public
 * domain — no attribution required; credited as a courtesy). */
export const NATURAL_EARTH_CREDIT = {
  key: 'natural-earth',
  html:
    'Physical region boundaries from ' +
    '<a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain)',
};

/** @type {Set<string>} Keys of dynamic credits already registered this session. */
const _dynamicCreditKeys = new Set();

/**
 * Register a conditional credit at the moment its data source activates.
 * Idempotent per `credit.key`; lands in the same "Data attribution" popover
 * as the static credits (showOnScreen=false).
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 * @param {{ key: string, html: string }} credit — e.g. `TOMTOM_CREDIT`
 * @returns {boolean} True when the credit is (now) registered.
 */
export function registerDynamicCredit(viewer, credit) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return false;
  }
  if (!credit?.key || !credit?.html) return false;
  if (_dynamicCreditKeys.has(credit.key)) return true;
  creditDisplay.addStaticCredit(new Cesium.Credit(credit.html, false));
  _dynamicCreditKeys.add(credit.key);
  return true;
}

/**
 * Register every per-layer data credit into the viewer's credit display.
 * Idempotent: safe to call once at init. Credits are static and always
 * present in the "Data attribution" popover.
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 */
export function registerDataCredits(viewer) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return;
  }
  for (const { html } of DATA_CREDITS) {
    // showOnScreen=false → lives in the expandable "Data attribution" popover,
    // not the on-globe credit line.
    creditDisplay.addStaticCredit(new Cesium.Credit(html, false));
  }
}
