# New OSINT Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 new toggleable Cesium data layers (Global Hazards, Volcanoes, Ocean Buoys, Ham Radio Propagation, Critical Infrastructure, Border Wait Times, Fireballs) and 2 panel enrichments (Space Weather gets DONKI solar events + NeoWs close approaches + NOAA R/S/G scales; Satellites gets ISS crew) to God's Eye View, all from free, keyless, no-cost APIs.

**Architecture:** Every live, globally-polled source (all except Critical Infrastructure) follows the `spaceWeatherProxy` pattern in `vite.config.js`: a single in-memory-TTL + disk-backed cache, in-flight request coalescing via the existing `coalesceProxyRequest` helper, and stale-on-error serving — no viewport/bbox parameters, because these datasets are small enough (tens to low hundreds of features) to fetch and cache whole. Critical Infrastructure is viewport-scoped (OSM has millions of hospitals/power plants worldwide) and instead follows the `militaryInstallationsProxy` pattern: bbox query params, bbox quantization, memory+disk cache keyed by snapped bbox. Every layer module follows the `earthquakes.js` layer contract exactly: `{id, name, icon, source, updateInterval, init, enable, disable, update, destroy, getAnalystRecords, getStats}`, registered into `DataLayerManager` in `src/main.js`, given a unique single-char token in `LAYER_STATE_REGISTRY` (`src/data/layerState.js`), and documented in `DATA_SOURCES.md` + `src/data/dataCredits.js`.

**Tech Stack:** Vite dev-server middleware (Node `http` req/res, no framework), CesiumJS entities/DataSources, vanilla JS ES modules, `node:test` + `node:assert/strict` for tests (`.test.mjs`, colocated with source).

**Spec:** This document is self-contained — no separate spec file. Every task below carries its own API facts (verified live against the real endpoints on 2026-08-30), field mappings, and filtering rules.

## Global Constraints

- No paid tiers, no API keys requiring signup with billing, no scraping of HTML pages not designed as data feeds. `DEMO_KEY` (NASA APIs) is acceptable as-is — it is public, keyless-in-spirit, and the codebase's existing `.env.example` convention is to let users optionally supply their own key later; do not block on requiring a real key.
- Every new Cesium entity must use **static** properties for anything that doesn't change between polls (no `Cesium.CallbackProperty` for per-frame geometry) — see the perf comment at the top of `src/data/earthquakes.js`. These are all small, infrequently-updated datasets; none of them need continuous rendering, so **none of these layers may call `holdContinuousRender`**.
- Every layer's `updateInterval` must respect the upstream's own guidance: PSKReporter asks for no more than one poll per 5 minutes (300000 ms); CBP updates hourly per port (use 300000 ms, i.e. 5 min, to stay well inside that); NDBC/GDACS/EONET/GVP/CNEOS/DONKI/NeoWs are all fine at 300000 ms (5 min) — there is no reason to poll disaster/space feeds by the minute.
- Every new proxy route must reuse the existing `coalesceProxyRequest` helper and `clientKey`/rate-limiter helpers already defined in `vite.config.js` (grep for their usage in `spaceWeatherProxy`/`militaryInstallationsProxy` before writing a task's route — do not reinvent them).
- Token assignment (`src/data/layerState.js` `LAYER_STATE_REGISTRY`, entries must stay alphabetically ordered by `id` and use `disposition: 'enabled-only'` — none of these need option groups):

  | id | token |
  |---|---|
  | `global-hazards` | `v` |
  | `volcanoes` | `2` |
  | `ocean-buoys` | `3` |
  | `ham-radio-propagation` | `4` |
  | `critical-infrastructure` | `5` |
  | `border-wait-times` | `6` |
  | `fireballs` | `7` |

  (Verified free before assignment: every lowercase letter a–z except `v` is already taken, plus digit `1`. Do not reuse any token already in the registry — check the live file before your task, another task in this plan may have landed first.)
- Every task ends with: the new/changed files pass `npm test -- <touched test files>` (or the project's full `npm test` if faster to reason about), and a git commit.

---

## Task 1: Global Hazards layer (GDACS + EONET merged)

**Files:**
- Create: `src/data/globalHazards.js`
- Create: `src/data/globalHazards.test.mjs`
- Modify: `vite.config.js` (new `globalHazardsProxy` plugin + registration in the plugins array, mirroring `spaceWeatherProxy`)
- Modify: `src/main.js` (import + `dataManager.register(globalHazardsLayer)`)
- Modify: `src/data/layerState.js` (`LAYER_STATE_REGISTRY` entry `{ id: 'global-hazards', token: 'v', disposition: 'enabled-only' }`, inserted alphabetically after `flights`/before `local-dams`... actually alphabetically `global-hazards` sorts between `gdelt-events` and `local-dams`)
- Modify: `src/data/dataCredits.js` (two new `DATA_CREDITS` entries, keys `gdacs` and `eonet`)
- Modify: `DATA_SOURCES.md` (two new table rows under "Live sources")

**Interfaces:**
- Produces: `export default globalHazardsLayer` — a layer object per the standard contract. `GLOBAL_HAZARDS_OVERLAY_SOURCE_ID = 'global-hazards'`. Pure functions exported for testing: `mapGdacsFeature(feature)`, `mapEonetFeature(feature)`, both returning `{ id, source: 'GDACS'|'EONET', kind, title, lat, lon, severity, url, dateMs }` or `null` if the feature should be filtered out.

### API facts (verified live 2026-08-30)

**GDACS** — `GET https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH` (no params needed, no key). Returns a GeoJSON `FeatureCollection`. Each feature's `properties` has: `eventtype` (2-letter code: `EQ`, `TC`, `FL`, `DR`, `VO`, `WF`), `eventid`, `episodeid`, `name`, `alertlevel` (`Green`|`Orange`|`Red`), `alertscore`, `country`, `fromdate`/`todate` (ISO strings), `datemodified`, `iscurrent` (`"true"`/`"false"` as strings), `url.report` (human report link), `severitydata.severitytext`. `geometry.coordinates` is `[lon, lat]`.

**Only keep `eventtype` in `['FL', 'DR']`** — `EQ` duplicates the existing USGS earthquakes layer, `TC` duplicates the existing NOAA NHC tropical-cyclones layer, `WF` duplicates the existing NASA FIRMS layer, and `VO` is handled by the dedicated, richer Task 2 volcanoes layer. Also drop `iscurrent !== "true"` and `alertlevel === "Green"` (Green is routine/no-impact noise — same significance-filtering principle as earthquakes' M2.5+ cutoff).

**EONET** — `GET https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300` (no key). Returns `{ events: [...] }`. Each event has `id`, `title`, `categories: [{id, title}]`, `geometry: [{ date, type: "Point", coordinates: [lon, lat], magnitudeValue, magnitudeUnit }]` (take the **last** geometry entry — EONET events can have a track of points over time; the most recent one is current). `closed` is `null` for ongoing events.

**Only keep events whose `categories[0].id` is one of**: `severeStorms`, `landslides`, `seaLakeIce`, `tempExtremes`, `dustHaze`, `snow`, `waterColor` — `wildfires` dups FIRMS, `volcanoes` dups Task 2, `earthquakes`/`floods` dup USGS/GDACS. Filter server-side in the proxy (EONET's `category` query param takes only one category id reliably; fetching unfiltered and filtering in code is the same approach GDACS above needs, so reuse one filter helper).

### Steps

- [ ] **Step 1: Write the proxy plugin in `vite.config.js`**

  Add near `spaceWeatherProxy` (same file region). Read that function first — copy its shape exactly: module-level `TTL_MS`, `MAX_RESPONSE_BYTES`, `CACHE_PATH`, an in-memory `cache` variable, `readDiskCache`/`writeDiskCache` helpers (or reuse the space-weather ones if they're already generic — check before duplicating), a `refreshUpstream()` that fetches both URLs with `Promise.allSettled` (one upstream being down must not blank the other), merges+filters per the rules above, and an `install(middlewares)` that serves `/api/global-hazards` with `coalesceProxyRequest` + stale-on-error, exactly like `/api/space-weather`.

  ```js
  const GDACS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
  const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300';
  const GLOBAL_HAZARDS_TTL_MS = 5 * 60 * 1000;
  const GLOBAL_HAZARDS_EONET_CATEGORIES = new Set([
    'severeStorms', 'landslides', 'seaLakeIce', 'tempExtremes', 'dustHaze', 'snow', 'waterColor',
  ]);
  const GLOBAL_HAZARDS_GDACS_TYPES = new Set(['FL', 'DR']);

  function mapGdacsFeatureServer(feature) {
    const p = feature?.properties;
    if (!p || !GLOBAL_HAZARDS_GDACS_TYPES.has(p.eventtype)) return null;
    if (p.iscurrent !== 'true' || p.alertlevel === 'Green') return null;
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return {
      id: `gdacs:${p.eventtype}:${p.eventid}`,
      source: 'GDACS',
      kind: p.eventtype,
      title: p.name || p.description || 'GDACS event',
      lat, lon,
      severity: p.alertlevel || 'Orange',
      url: p.url?.report || null,
      dateMs: Date.parse(p.datemodified || p.fromdate || '') || null,
    };
  }

  function mapEonetFeatureServer(event) {
    const categoryId = event?.categories?.[0]?.id;
    if (!categoryId || !GLOBAL_HAZARDS_EONET_CATEGORIES.has(categoryId)) return null;
    const geom = Array.isArray(event.geometry) ? event.geometry.at(-1) : null;
    const [lon, lat] = geom?.coordinates || [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return {
      id: `eonet:${event.id}`,
      source: 'EONET',
      kind: categoryId,
      title: event.title || 'EONET event',
      lat, lon,
      severity: 'Orange',
      url: event.link || null,
      dateMs: Date.parse(geom?.date || '') || null,
    };
  }
  ```

  Wire these two into the merge function, mirror `spaceWeatherProxy`'s `Promise.allSettled([fetch(GDACS_URL), fetch(EONET_URL)])`, cap total merged records at 400, serve JSON `{ hazards: [...], retrievedAt }`.

- [ ] **Step 2: Write `src/data/globalHazards.js`**

  Mirror `src/data/earthquakes.js` structure exactly (it is the closest analog: small polled point dataset, static ellipse/label markers, no per-frame animation, `getAnalystRecords`, `getStats`). Differences:
  - `id: 'global-hazards'`, `name: 'Global Hazards (GDACS + EONET)'`, `icon: '🚨'`, `source: 'GDACS / NASA EONET'`, `updateInterval: 300000`.
  - Fetch from `/api/global-hazards` (not directly from GDACS/EONET — the browser proxy is required, both upstreams' CORS posture is unreliable for direct browser fetches, same reasoning as `spaceWeatherProxy`'s doc comment).
  - Render each hazard as a `billboard`-free colored point (`Cesium.PointGraphics`, not an ellipse — these are discrete alert markers, not magnitude-scaled zones) sized by `severity` (`Red` → bigger/red, `Orange` → smaller/orange), with a `label` showing `kind` (e.g. `FL`, `DR`, `severeStorms`).
  - `mapAnalystRecord(raw, index)` mirrors `earthquakes.js`'s but maps `{id, source, kind, title, lat, lon, severity, dateMs}` — same null-not-NaN/undefined discipline, same `JSON.stringify` round-trip safety requirement.

- [ ] **Step 3: Write `src/data/globalHazards.test.mjs`**

  Mirror `earthquakes.test.mjs`'s test list, adapted: (a) `mapAnalystRecord` full-record mapping, (b) missing-id fallback, (c) missing-fields-become-null discipline, (d) JSON-safety, (e) a lifecycle test with mocked `fetch` returning a synthetic `/api/global-hazards` payload and asserting the right number of entities land in the `CustomDataSource`, (f) an error-then-recovery test mirroring earthquakes' last test (`layer.getStats().error` set on failure, cleared on the next successful poll).

- [ ] **Step 4: Register in `src/main.js`**

  Add `import globalHazardsLayer from './data/globalHazards.js';` near the other layer imports (alphabetical-ish grouping — put it near `gdeltEventsLayer`), and `dataManager.register(globalHazardsLayer);` near `dataManager.register(gdeltEventsLayer);`.

- [ ] **Step 5: Register in `src/data/layerState.js`**

  Insert `Object.freeze({ id: 'global-hazards', token: 'v', disposition: 'enabled-only' }),` into `LAYER_STATE_REGISTRY`, alphabetically between the `gdelt-events` and `local-dams` entries.

- [ ] **Step 6: Register credits in `src/data/dataCredits.js`**

  Add to `DATA_CREDITS` (near the `gdelt`/`google-news-rss` entries):

  ```js
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
  ```

- [ ] **Step 7: Document in `DATA_SOURCES.md`**

  Add two rows to the "Live sources" table:

  ```
  | **GDACS** | Global disaster alerts — floods and droughts | Free public API, no key, courtesy citation requested | "GDACS — Global Disaster Alert and Coordination System" |
  | **NASA EONET** | Natural event tracker — severe storms, landslides, sea/lake ice, temperature extremes, dust/haze, snow, water color | US public domain | "NASA EONET" |
  ```

- [ ] **Step 8: Run tests, verify, commit**

  `npm test -- src/data/globalHazards.test.mjs`. Then start the dev server and confirm `/api/global-hazards` returns real merged JSON and the toggle panel shows "Global Hazards (GDACS + EONET)". Commit as one change covering all files above.

---

## Task 2: Volcanoes layer (Smithsonian Global Volcanism Program)

**Files:**
- Create: `src/data/volcanoes.js`
- Create: `src/data/volcanoes.test.mjs`
- Modify: `vite.config.js` (`volcanoesProxy` plugin, mirrors `spaceWeatherProxy`)
- Modify: `src/main.js`, `src/data/layerState.js` (token `2`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Produces: `export default volcanoesLayer`. Pure function `mapVolcanoFeature(feature)` → `{ id, name, lat, lon, lastEruptionYear, country, volcanoType, elevationM }` or `null`.

### API facts (verified live 2026-08-30)

`GET https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=json` — no key, returns a GeoJSON `FeatureCollection` of ~1,400 Holocene volcanoes worldwide. `properties` includes `Volcano_Number`, `Volcano_Name`, `Primary_Volcano_Type`, `Last_Eruption_Year` (integer, can be negative for BCE, e.g. `-8300`), `Country`, `Elevation` (meters), `Latitude`, `Longitude` (also duplicated in `geometry.coordinates` as `[lon, lat]`).

**Filter to `Last_Eruption_Year >= 1900`** — keeps volcanoes with eruptions in roughly the last 125 years (a few hundred features), which is "recently active" without dumping all 1,400 Holocene volcanoes (most dormant for millennia) onto the globe. This is a static-ish dataset (eruption history doesn't change day to day); cache with a **24-hour TTL**, not 5 minutes — set `updateInterval: 3600000` (1 hour) client-side, well above the 24h server TTL so it's always served from cache in practice.

### Steps

- [ ] **Step 1: Write the proxy plugin in `vite.config.js`**

  Mirror `spaceWeatherProxy` but with `TTL_MS = 24 * 60 * 60 * 1000`. Single upstream (no merge). Filter server-side: `parsed.features.filter(f => Number(f.properties?.Last_Eruption_Year) >= 1900)`, cap at 500, serve `/api/volcanoes` returning `{ volcanoes: [...], retrievedAt }` where each entry is already mapped to `{ id, name, lat, lon, lastEruptionYear, country, volcanoType, elevationM }` (do the field mapping server-side so the client module stays thin, same division of labor as `spaceWeatherProxy` pre-shaping its aurora grid).

- [ ] **Step 2: Write `src/data/volcanoes.js`**

  Mirror `earthquakes.js`. `id: 'volcanoes'`, `name: 'Active Volcanoes (Smithsonian GVP)'`, `icon: '🌋'`, `source: 'Smithsonian Institution — Global Volcanism Program'`, `updateInterval: 3600000`. Render as a static `point` + `label` (name), colored by recency band: `lastEruptionYear >= 2000` → red, `>= 1950` → orange, else → yellow (three-band scheme mirroring `earthquakes.js`'s `depthColor` pattern). `mapAnalystRecord` maps the same fields, JSON-safe, null-not-undefined.

- [ ] **Step 3: Write `src/data/volcanoes.test.mjs`**

  Mirror the earthquakes test list (analyst record shape, missing-field discipline, JSON-safety, lifecycle with mocked fetch, error/recovery). Include one test asserting the color-band boundaries (`lastEruptionYear: 2015` → red, `1960` → orange, `1920` → yellow).

- [ ] **Step 4–7: Register** (main.js import + `dataManager.register(volcanoesLayer)`; `layerState.js` entry `{ id: 'volcanoes', token: '2', disposition: 'enabled-only' }` inserted alphabetically after `vessel-events` and before `weather-alerts` (verified by direct string comparison: `"vessel-events" < "volcanoes" < "weather-alerts"`); dataCredits.js entry:

  ```js
  {
    key: 'gvp',
    html:
      'Volcano data: Global Volcanism Program, Smithsonian Institution — ' +
      '<a href="https://volcano.si.edu" target="_blank" rel="noopener">volcano.si.edu</a>',
  },
  ```

  DATA_SOURCES.md row:

  ```
  | **Smithsonian Global Volcanism Program** | Volcanoes with eruptions since 1900 | Free public WFS service; citation requested | "Global Volcanism Program, Smithsonian Institution" |
  ```

- [ ] **Step 8: Run tests, verify, commit**

---

## Task 3: Ocean Buoys layer (NOAA NDBC)

**Files:**
- Create: `src/data/oceanBuoys.js`
- Create: `src/data/oceanBuoys.test.mjs`
- Modify: `vite.config.js` (`oceanBuoysProxy`), `src/main.js`, `src/data/layerState.js` (token `3`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Produces: `export default oceanBuoysLayer`. Pure function `parseNdbcLine(line)` → `{ id, lat, lon, windSpeedMs, waveHeightM, airTempC, waterTempC }` or `null` for a header/malformed line. Pure function `parseNdbcText(text)` → array of parsed records (splits lines, skips the two `#`-prefixed header lines, calls `parseNdbcLine` per line, drops nulls).

### API facts (verified live 2026-08-30)

`GET https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt` — no key, plain text, ~800 buoy stations worldwide. Fixed-column format (whitespace-separated, NOT comma), first two lines are `#`-prefixed headers:

```
#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
22101    37.24   126.02  2026 08 30 11 00  20   1.0    MM  0.0   0   MM  MM     MM    MM  25.0  26.2    MM   MM     MM
```

Columns in order: `STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE`. **`MM` means missing** — must map to `null`, never `NaN`. Split each data line on `/\s+/` (whitespace-collapsed), index into the column list above.

### Steps

- [ ] **Step 1: Write `parseNdbcLine`/`parseNdbcText` as pure functions inside `src/data/oceanBuoys.js`**

  ```js
  const NDBC_COLUMNS = ['stn', 'lat', 'lon', 'yyyy', 'mm', 'dd', 'hh', 'mn', 'wdir', 'wspd', 'gst', 'wvht', 'dpd', 'apd', 'mwd', 'pres', 'ptdy', 'atmp', 'wtmp', 'dewp', 'vis', 'tide'];

  function ndbcNum(token) {
    if (token === undefined || token === 'MM') return null;
    const n = Number(token);
    return Number.isFinite(n) ? n : null;
  }

  export function parseNdbcLine(line) {
    if (typeof line !== 'string' || !line.trim() || line.trim().startsWith('#')) return null;
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < NDBC_COLUMNS.length) return null;
    const row = Object.fromEntries(NDBC_COLUMNS.map((key, i) => [key, tokens[i]]));
    const lat = ndbcNum(row.lat);
    const lon = ndbcNum(row.lon);
    if (lat === null || lon === null) return null;
    return {
      id: row.stn,
      lat,
      lon,
      windSpeedMs: ndbcNum(row.wspd),
      waveHeightM: ndbcNum(row.wvht),
      airTempC: ndbcNum(row.atmp),
      waterTempC: ndbcNum(row.wtmp),
    };
  }

  export function parseNdbcText(text) {
    if (typeof text !== 'string') return [];
    return text.split('\n').map(parseNdbcLine).filter(Boolean);
  }
  ```

- [ ] **Step 2: Write the proxy plugin in `vite.config.js`**

  Mirror `spaceWeatherProxy`, `TTL_MS = 5 * 60 * 1000`, single upstream `https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt`, fetch as **text** (not JSON — `await upstream.text()`, not `.json()`), parse server-side with the same `parseNdbcText` logic (duplicate the tiny pure function server-side in `vite.config.js` since it's Node code, not importable from `src/` — same reasoning `spaceWeatherProxy` doesn't import client modules), cap at 900 records, serve `/api/ocean-buoys` as `{ buoys: [...], retrievedAt }`.

- [ ] **Step 3: Write the rest of `src/data/oceanBuoys.js`**

  Mirror `earthquakes.js` lifecycle. `id: 'ocean-buoys'`, `name: 'Ocean Buoys (NOAA NDBC)'`, `icon: '🛟'`, `source: 'NOAA National Data Buoy Center'`, `updateInterval: 300000`. Fetch from `/api/ocean-buoys`. Render as a static `point` sized/colored by `waveHeightM` (or gray if `null` — a buoy reporting nothing shouldn't look alarming), with a label showing wind speed. `mapAnalystRecord` maps `{id, lat, lon, windSpeedMs, waveHeightM, airTempC, waterTempC}`.

- [ ] **Step 4: Write `src/data/oceanBuoys.test.mjs`**

  Real, concrete assertions on the fixed-width parser (this is the correctness-critical part of this task):

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { parseNdbcLine, parseNdbcText } from './oceanBuoys.js';

  test('parseNdbcLine: parses a well-formed data row', () => {
    const line = '22101    37.24   126.02  2026 08 30 11 00  20   1.0    MM  0.0   0   MM  MM     MM    MM  25.0  26.2    MM   MM     MM';
    assert.deepEqual(parseNdbcLine(line), {
      id: '22101', lat: 37.24, lon: 126.02,
      windSpeedMs: 1.0, waveHeightM: 0.0, airTempC: 25.0, waterTempC: 26.2,
    });
  });

  test('parseNdbcLine: "MM" missing markers become null, never NaN', () => {
    const r = parseNdbcLine('99999 10.0 -20.0 2026 01 01 00 00 MM MM MM MM MM MM MM MM MM MM MM MM MM');
    assert.equal(r.windSpeedMs, null);
    assert.equal(r.waveHeightM, null);
    for (const v of Object.values(r)) assert.notEqual(v, undefined);
  });

  test('parseNdbcLine: header lines and short lines return null', () => {
    assert.equal(parseNdbcLine('#STN LAT LON'), null);
    assert.equal(parseNdbcLine(''), null);
    assert.equal(parseNdbcLine('short line'), null);
  });

  test('parseNdbcText: skips headers, parses data rows, drops malformed ones', () => {
    const text = [
      '#STN LAT LON header',
      '#text units header',
      '22101 37.24 126.02 2026 08 30 11 00 20 1.0 MM 0.0 0 MM MM MM MM 25.0 26.2 MM MM MM',
      '',
    ].join('\n');
    const rows = parseNdbcText(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, '22101');
  });
  ```

  Plus the standard lifecycle + analyst-record-JSON-safety tests mirroring `earthquakes.test.mjs`.

- [ ] **Step 5–7: Register.** `layerState.js` token `3`, id `ocean-buoys` (sorts after `military-installations`, before `openseamap-seamarks` — verified by direct string comparison). Credit:

  ```js
  {
    key: 'ndbc',
    html:
      'Ocean buoy observations: NOAA National Data Buoy Center — ' +
      '<a href="https://www.ndbc.noaa.gov" target="_blank" rel="noopener">ndbc.noaa.gov</a> ' +
      '(US public domain)',
  },
  ```

  DATA_SOURCES.md row:

  ```
  | **NOAA National Data Buoy Center** | Ocean buoy observations — wind, wave height, sea/air temperature | US public domain | "NOAA National Data Buoy Center" |
  ```

- [ ] **Step 8: Run tests, verify, commit**

---

## Task 4: Ham Radio Propagation layer (PSKReporter)

**Files:**
- Create: `src/data/hamRadioPropagation.js`
- Create: `src/data/hamRadioPropagation.test.mjs`
- Modify: `vite.config.js` (`hamRadioProxy`), `src/main.js`, `src/data/layerState.js` (token `4`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Produces: `export default hamRadioPropagationLayer`. Pure function `maidenheadToLatLon(locator)` → `{ lat, lon }` or `null` for an invalid locator. Pure function `parsePskReporterXml(xmlText)` → array of `{ id, senderCallsign, receiverCallsign, senderLat, senderLon, receiverLat, receiverLon, frequencyHz, mode, snr, flowStartSeconds }`.

### API facts (verified live 2026-08-30)

`GET https://retrieve.pskreporter.info/query?mode=FT8&rptlimit=200&flowStartSeconds=-900` — no key, no signup. Returns **XML** (not JSON): `<receptionReports currentSeconds="..."><receptionReport receiverCallsign="PE1OID" receiverLocator="JO33ki90" senderCallsign="CU2AP" senderLocator="HM77ET" frequency="18102364" flowStartSeconds="1788091549" mode="FT8" sNR="-13" .../>...</receptionReports>`. Locators are **Maidenhead grid squares** (4, 6, or 8 characters), not lat/lon — decode with the standard algorithm below. **PSKReporter's developer page explicitly asks for no more than one poll every 5 minutes** — `updateInterval: 300000` is a hard requirement here, not just a nicety.

### Steps

- [ ] **Step 1: Write `maidenheadToLatLon` in `src/data/hamRadioPropagation.js`**

  Standard Maidenhead decode (field = 20°lon × 10°lat, square = 2°lon × 1°lat, subsquare = 5′lon × 2.5′lat; return the **center** of the smallest resolved cell):

  ```js
  const MAIDENHEAD_RE = /^[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2})?([0-9]{2})?$/;

  export function maidenheadToLatLon(locator) {
    if (typeof locator !== 'string' || !MAIDENHEAD_RE.test(locator.trim())) return null;
    const loc = locator.trim().toUpperCase();
    const A = 'A'.charCodeAt(0);
    let lon = (loc.charCodeAt(0) - A) * 20 - 180;
    let lat = (loc.charCodeAt(1) - A) * 10 - 90;
    lon += Number(loc[2]) * 2;
    lat += Number(loc[3]) * 1;
    let lonRes = 2;
    let latRes = 1;
    if (loc.length >= 6) {
      lon += (loc.charCodeAt(4) - A) * (2 / 24);
      lat += (loc.charCodeAt(5) - A) * (1 / 24);
      lonRes = 2 / 24;
      latRes = 1 / 24;
    }
    return { lat: lat + latRes / 2, lon: lon + lonRes / 2 };
  }
  ```

- [ ] **Step 2: Write `parsePskReporterXml`**

  Parse with a minimal regex/attribute extractor (no DOM parser available in this Node proxy context — mirror how `firmsCsv.js` or another existing text-format parser in this codebase avoids pulling in a heavy dependency; check `src/data/firmsCsv.js` briefly for the house style of hand-rolled parsing before writing this). Extract each `<receptionReport .../>` self-closing tag, pull `receiverCallsign`, `receiverLocator`, `senderCallsign`, `senderLocator`, `frequency`, `mode`, `sNR`, `flowStartSeconds` via attribute regexes, decode both locators with `maidenheadToLatLon`, **drop the record if either locator fails to decode**. Cap at 200 records (matches the `rptlimit` request param, belt-and-suspenders).

- [ ] **Step 3: Write the proxy plugin in `vite.config.js`**

  Mirror `spaceWeatherProxy`, `TTL_MS = 5 * 60 * 1000` (matches PSKReporter's own minimum poll interval — this cache TTL is not just perf, it's the thing that keeps the app compliant with PSKReporter's usage policy no matter how many browser tabs are open). Fetch `https://retrieve.pskreporter.info/query?mode=FT8&rptlimit=200&flowStartSeconds=-900` as text, parse server-side (duplicate the parse logic, same reasoning as Task 3), serve `/api/ham-radio` as `{ spots: [...], retrievedAt }` with each spot pre-mapped to lat/lon (do the Maidenhead decode server-side too, so the client stays thin — but keep `maidenheadToLatLon` exported from the client module anyway since Task's tests need to verify it directly, and duplicate the tiny function server-side like the other tasks do).

- [ ] **Step 4: Write the rest of `src/data/hamRadioPropagation.js`**

  Mirror `earthquakes.js` lifecycle but render **polylines** (`Cesium.PolylineGraphics`, static `positions: [senderPos, receiverPos]`, NOT a `CallbackProperty` array), not points — each spot is an arc between two stations. `id: 'ham-radio-propagation'`, `name: 'Ham Radio Propagation (PSKReporter)'`, `icon: '📡'`, `source: 'PSKReporter.info'`, `updateInterval: 300000`. Color/opacity by `snr` (higher SNR = brighter). `mapAnalystRecord` maps `{id, senderCallsign, receiverCallsign, senderLat, senderLon, receiverLat, receiverLon, frequencyHz, mode, snr}`.

- [ ] **Step 5: Write `src/data/hamRadioPropagation.test.mjs`**

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { maidenheadToLatLon, parsePskReporterXml } from './hamRadioPropagation.js';

  test('maidenheadToLatLon: 4-char locator decodes to the field/square center', () => {
    const { lat, lon } = maidenheadToLatLon('FN20');
    assert.ok(Math.abs(lat - 40.5) < 0.01);
    assert.ok(Math.abs(lon - -74) < 0.01);
  });

  test('maidenheadToLatLon: 6-char locator resolves to sub-square precision', () => {
    const four = maidenheadToLatLon('JO33');
    const six = maidenheadToLatLon('JO33ki');
    assert.notEqual(four.lat, six.lat);
    assert.ok(Math.abs(six.lat - four.lat) < 1);
  });

  test('maidenheadToLatLon: invalid input returns null, never throws', () => {
    assert.equal(maidenheadToLatLon(''), null);
    assert.equal(maidenheadToLatLon('12'), null);
    assert.equal(maidenheadToLatLon(null), null);
    assert.equal(maidenheadToLatLon(undefined), null);
  });

  test('parsePskReporterXml: extracts reception reports and decodes both locators', () => {
    const xml = '<receptionReports currentSeconds="1"><receptionReport receiverCallsign="PE1OID" receiverLocator="JO33ki90" senderCallsign="CU2AP" senderLocator="HM77ET" frequency="18102364" flowStartSeconds="1788091549" mode="FT8" sNR="-13" /></receptionReports>';
    const spots = parsePskReporterXml(xml);
    assert.equal(spots.length, 1);
    assert.equal(spots[0].senderCallsign, 'CU2AP');
    assert.equal(spots[0].receiverCallsign, 'PE1OID');
    assert.equal(spots[0].snr, -13);
    assert.ok(Number.isFinite(spots[0].senderLat) && Number.isFinite(spots[0].senderLon));
  });

  test('parsePskReporterXml: a record with an undecodable locator is dropped, not crashed on', () => {
    const xml = '<receptionReports currentSeconds="1"><receptionReport receiverCallsign="X" receiverLocator="ZZ" senderCallsign="Y" senderLocator="JO33ki90" frequency="1" flowStartSeconds="1" mode="FT8" sNR="0" /></receptionReports>';
    assert.equal(parsePskReporterXml(xml).length, 0);
  });
  ```

  Plus standard lifecycle/analyst-record tests.

- [ ] **Step 6–8: Register.** `layerState.js` token `4`, id `ham-radio-propagation` (sorts after `gdelt-events`/`global-hazards`, before `local-dams` — alongside Task 1's insertion point, resolve ordering against whatever Task 1 already landed). Credit:

  ```js
  {
    key: 'pskreporter',
    html:
      'Amateur radio propagation spots: ' +
      '<a href="https://pskreporter.info" target="_blank" rel="noopener">PSKReporter.info</a>',
  },
  ```

  DATA_SOURCES.md row:

  ```
  | **PSKReporter** | Amateur (ham) radio propagation reception spots | Free public API; polled at most once per 5 minutes per PSKReporter's usage policy | "PSKReporter.info" |
  ```

- [ ] **Step 9: Run tests, verify, commit**

---

## Task 5: Critical Infrastructure layer (OSM power plants + hospitals)

**Files:**
- Create: `src/data/criticalInfrastructure.js`
- Create: `src/data/criticalInfrastructure.test.mjs`
- Modify: `vite.config.js` (`criticalInfrastructureProxy`, bbox-scoped — mirrors `militaryInstallationsProxy`, not `spaceWeatherProxy`)
- Modify: `src/main.js`, `src/data/layerState.js` (token `5`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Produces: `export default criticalInfrastructureLayer`. Pure function `mapOverpassElement(element)` → `{ id, kind: 'power-plant'|'hospital', name, lat, lon }` or `null`.

### Design note

This is the one layer in this batch that is **viewport-scoped, not global** — OSM has hundreds of thousands of hospitals and tens of thousands of power plants worldwide; fetching them all would be an enormous, useless payload. Follow `militaryInstallationsProxy` (`vite.config.js`, search for `militaryInstallationsProxy` / `/api/military-installations`) as the structural template: bbox query params (`south`, `west`, `north`, `east`), `validMilitaryInstallationBox`-style validation (reject boxes > 10° on a side or spanning the antimeridian), bbox quantization so neighboring viewports share a cache entry, memory + disk cache keyed by the quantized bbox, `elementCap` + `saturated` flag in the response so the client can re-ask with `exact=1` when truncated. **Read that function in full before writing this task** — do not guess at the caching/quantization helpers' names; reuse them if they're already generic, or copy-and-adapt if they're hardcoded to the military-installations cache maps.

Do **not** add a "ports" category — the existing OpenSeaMap seamarks layer (`src/data/rasterOverlays.js`, `openseamap-seamarks`) already renders harbours from the seamark tag scheme; a second vector ports layer here would duplicate it.

### API facts

Overpass QL (same upstream as the existing `/api/overpass` and `/api/military-installations` routes, `https://overpass-api.de/api/interpreter` or whatever `fetchOverpassPayload`'s configured endpoint is — reuse that helper, don't hardcode a new URL):

```
[out:json][timeout:20];(nwr["power"="plant"](${bbox});nwr["amenity"="hospital"](${bbox}););out center tags geom ${CAP};
```

Response `elements[]` items have `tags.power === 'plant'` or `tags.amenity === 'hospital'`, `tags.name` (may be absent — fall back to `'Unnamed power plant'`/`'Unnamed hospital'`), and either direct `lat`/`lon` (for `node` elements) or `center.lat`/`center.lon` (for `way`/`relation` elements, since the query uses `out center`).

### Steps

- [ ] **Step 1: Read `militaryInstallationsProxy` in full** (the whole function, `vite.config.js`, plus its supporting cache/disk helpers above it) to learn the exact reusable helper names (`fetchOverpassPayload`, `coalesceProxyRequest`, disk cache read/write, bbox quantize/cache-key functions, rate limiter factory).

- [ ] **Step 2: Write the proxy plugin in `vite.config.js`**

  Copy `militaryInstallationsProxy`'s structure onto a new `criticalInfrastructureProxy()`, route `/api/critical-infrastructure`, Overpass QL from above, element cap 300, response shape `{ elements: [...mapped...], saturated, elementCap, retrievedAt, status }` where each element is pre-mapped server-side to `{ id, kind, name, lat, lon }` (`id` = `` `${element.type}/${element.id}` ``, `kind` = `'power-plant'` if `tags.power === 'plant'` else `'hospital'`, `lat`/`lon` from `element.lat ?? element.center?.lat` / `element.lon ?? element.center?.lon`, dropping any element where neither resolves to a finite number).

- [ ] **Step 3: Write `src/data/criticalInfrastructure.js`**

  Mirror `militaryInstallations.js`'s client-side viewport-driven fetch pattern (it queries `/api/military-installations?${bbox params}` on camera-move, not on a fixed timer — check how it hooks `viewer.camera.moveEnd` or similar and copy that wiring, since this layer needs the same "refetch when the view changes" behavior, not blind polling). `id: 'critical-infrastructure'`, `name: 'Critical Infrastructure (Power & Hospitals)'`, `icon: '🏭'`, `source: 'OpenStreetMap (Overpass API)'`. Render as static points: power plants orange, hospitals red-cross-colored (white point with a small cross label, or reuse whatever icon convention `militaryInstallations.js` uses for point styling). `mapAnalystRecord` maps `{id, kind, name, lat, lon}`.

- [ ] **Step 4: Write `src/data/criticalInfrastructure.test.mjs`**

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mapOverpassElement } from './criticalInfrastructure.js';

  test('mapOverpassElement: node with power=plant tag maps to a power-plant record', () => {
    const el = { type: 'node', id: 1, lat: 51.5, lon: -0.1, tags: { power: 'plant', name: 'Battersea' } };
    assert.deepEqual(mapOverpassElement(el), { id: 'node/1', kind: 'power-plant', name: 'Battersea', lat: 51.5, lon: -0.1 });
  });

  test('mapOverpassElement: way with amenity=hospital uses the center point', () => {
    const el = { type: 'way', id: 2, center: { lat: 40.7, lon: -74.0 }, tags: { amenity: 'hospital', name: 'City General' } };
    assert.deepEqual(mapOverpassElement(el), { id: 'way/2', kind: 'hospital', name: 'City General', lat: 40.7, lon: -74.0 });
  });

  test('mapOverpassElement: missing name falls back to a generic label per kind', () => {
    assert.equal(mapOverpassElement({ type: 'node', id: 3, lat: 0, lon: 0, tags: { power: 'plant' } }).name, 'Unnamed power plant');
    assert.equal(mapOverpassElement({ type: 'node', id: 4, lat: 0, lon: 0, tags: { amenity: 'hospital' } }).name, 'Unnamed hospital');
  });

  test('mapOverpassElement: element with neither direct nor center coordinates returns null', () => {
    assert.equal(mapOverpassElement({ type: 'way', id: 5, tags: { power: 'plant' } }), null);
  });

  test('mapOverpassElement: element with neither tag matches returns null', () => {
    assert.equal(mapOverpassElement({ type: 'node', id: 6, lat: 0, lon: 0, tags: { shop: 'bakery' } }), null);
  });
  ```

  Plus lifecycle tests mirroring `militaryInstallations.test.mjs` (viewport refetch on camera move, saturated/exact re-query behavior) — read that test file for the pattern before writing these.

- [ ] **Step 5–7: Register.** `layerState.js` token `5`, id `critical-infrastructure` (sorts after `cctv`, before `earthquakes`). Credit — note this **reuses** the existing `overpass` credit key (same OSM/ODbL data), so **do not add a new dataCredits.js entry**; only add the DATA_SOURCES.md row:

  ```
  | **OpenStreetMap (Overpass API)** — power plants & hospitals | Critical infrastructure points, viewport-scoped | ODbL 1.0 (shares the existing Overpass/OSM credit) | "© OpenStreetMap contributors" |
  ```

- [ ] **Step 8: Run tests, verify, commit**

---

## Task 6: Border Wait Times layer (CBP)

**Files:**
- Create: `src/data/borderWaitTimes.js`
- Create: `src/data/borderWaitTimes.test.mjs`
- Create: `config/cbp_port_locations.json`
- Modify: `vite.config.js` (`borderWaitTimesProxy`), `src/main.js`, `src/data/layerState.js` (token `6`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Produces: `export default borderWaitTimesLayer`. Pure function `mapWaitTimeEntry(entry, locations)` → `{ id, name, border, lat, lon, waitMinutes, status }` or `null` if `entry.port_number` has no match in the `locations` lookup.

### API facts (verified live 2026-08-30)

`GET https://bwt.cbp.gov/api/waittimes` — no key, no auth, returns a plain **JSON array** (not wrapped in an envelope). Each entry: `port_number` (6-char string, e.g. `"070801"`), `border` (`"Canadian Border"` or `"Mexican Border"`), `port_name`, `crossing_name`, `port_status` (`"Open"`/`"Closed"`), and nested `passenger_vehicle_lanes.standard_lanes.delay_minutes` (string, may be `""`). **The endpoint does not include coordinates** — only `port_number`/`port_name`. There is no discoverable companion endpoint with lat/lon (confirmed by testing `/api/bwtPorts`, `/api/ports`, and several ArcGIS FeatureServer guesses — none exist or none returned real data within reasonable effort).

**Because of this, this task needs a small bundled static lookup**, `config/cbp_port_locations.json`, mapping `port_number → {name, lat, lon}` for the major, well-documented land border crossings. Scope this to the **~25 highest-traffic crossings** (the ones with unambiguous, well-known locations — e.g. San Ysidro, Laredo, El Paso, Detroit/Ambassador Bridge, Buffalo/Peace Bridge, Blaine/Peace Arch) rather than attempting all ~115 CBP ports, to keep the manually-curated data small and low-risk. **The implementing engineer must verify each port's `port_number` against a live call to `https://bwt.cbp.gov/api/waittimes` (match on `port_name`/`crossing_name`) and its coordinates against an independent source (e.g. OpenStreetMap Nominatim search for the crossing name) before adding it to the JSON file** — do not hand-type coordinates from memory without checking; a wrong crossing coordinate is a silent, hard-to-catch data-quality bug in a way a missing feature is not.

### Steps

- [ ] **Step 1: Build `config/cbp_port_locations.json`**

  Fetch `https://bwt.cbp.gov/api/waittimes` live, pick the ~25 highest-traffic crossings by cross-referencing well-known major land ports (San Ysidro CA, Otay Mesa CA, Calexico CA, Nogales AZ, El Paso TX ×2-3 bridges, Laredo TX ×2, Hidalgo/Pharr TX, Brownsville TX, Detroit MI/Ambassador Bridge, Port Huron MI, Buffalo NY/Peace Bridge, Champlain NY, Blaine WA/Peace Arch, Sweetgrass MT), record each one's exact `port_number` from the live response, and verify each lat/lon independently (Nominatim or equivalent) before writing the file. Shape:

  ```json
  {
    "070801": { "name": "Alexandria Bay — Thousand Islands Bridge", "lat": 44.339, "lon": -75.918 },
    "250401": { "name": "San Ysidro", "lat": 32.543, "lon": -117.030 }
  }
  ```

  (These two sample entries illustrate shape only — the executing engineer replaces/expands with verified real entries per the process above; do not ship these two specific lines unverified.)

- [ ] **Step 2: Write the proxy plugin in `vite.config.js`**

  Mirror `spaceWeatherProxy`, `TTL_MS = 5 * 60 * 1000`. Fetch `https://bwt.cbp.gov/api/waittimes` as JSON, load `config/cbp_port_locations.json` once at module init (`JSON.parse(await fsp.readFile(...))`, cached in memory — it's static config, not re-read per request), join on `port_number`, drop entries with no location match, serve `/api/border-wait-times` as `{ crossings: [...mapped...], retrievedAt }`.

- [ ] **Step 3: Write `src/data/borderWaitTimes.js`**

  Mirror `earthquakes.js` lifecycle. `id: 'border-wait-times'`, `name: 'Border Wait Times (CBP)'`, `icon: '🛂'`, `source: 'U.S. Customs and Border Protection'`, `updateInterval: 300000`. Static point + label showing wait minutes, colored green (`< 20 min`) / yellow (`20–60 min`) / red (`> 60 min`) — three-band scheme mirroring `earthquakes.js`'s depth bands. `mapWaitTimeEntry(entry, locations)` is the pure, testable join+map function (also used server-side, duplicated per this batch's established pattern).

- [ ] **Step 4: Write `src/data/borderWaitTimes.test.mjs`**

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mapWaitTimeEntry } from './borderWaitTimes.js';

  const LOCATIONS = { '070801': { name: 'Alexandria Bay', lat: 44.339, lon: -75.918 } };

  test('mapWaitTimeEntry: matched port maps wait minutes and status', () => {
    const entry = {
      port_number: '070801', border: 'Canadian Border', port_status: 'Open',
      passenger_vehicle_lanes: { standard_lanes: { delay_minutes: '15' } },
    };
    assert.deepEqual(mapWaitTimeEntry(entry, LOCATIONS), {
      id: '070801', name: 'Alexandria Bay', border: 'Canadian Border',
      lat: 44.339, lon: -75.918, waitMinutes: 15, status: 'Open',
    });
  });

  test('mapWaitTimeEntry: unmatched port_number returns null', () => {
    assert.equal(mapWaitTimeEntry({ port_number: '999999' }, LOCATIONS), null);
  });

  test('mapWaitTimeEntry: empty-string delay_minutes becomes null, not NaN', () => {
    const entry = {
      port_number: '070801', border: 'Canadian Border', port_status: 'Open',
      passenger_vehicle_lanes: { standard_lanes: { delay_minutes: '' } },
    };
    assert.equal(mapWaitTimeEntry(entry, LOCATIONS).waitMinutes, null);
  });
  ```

  Plus standard lifecycle/analyst-record tests, and a test asserting `config/cbp_port_locations.json` parses as valid JSON and every entry has finite `lat`/`lon` within valid ranges (`-90..90`/`-180..180`) — a cheap guard against a typo'd coordinate shipping silently.

- [ ] **Step 5–7: Register.** `layerState.js` token `6`, id `border-wait-times` (sorts after `bikeshare`, before `cctv`). Credit:

  ```js
  {
    key: 'cbp-bwt',
    html:
      'Land border crossing wait times: U.S. Customs and Border Protection — ' +
      '<a href="https://bwt.cbp.gov" target="_blank" rel="noopener">Border Wait Times</a> ' +
      '(US public domain; major crossings only)',
  },
  ```

  DATA_SOURCES.md row:

  ```
  | **CBP Border Wait Times** | Estimated wait times at major US land border crossings (curated subset — CBP's API has no coordinates) | US public domain | "U.S. Customs and Border Protection" |
  ```

- [ ] **Step 8: Run tests, verify, commit**

---

## Task 7: Fireballs layer (NASA/JPL CNEOS)

**Files:**
- Create: `src/data/fireballs.js`
- Create: `src/data/fireballs.test.mjs`
- Modify: `vite.config.js` (`fireballsProxy`), `src/main.js`, `src/data/layerState.js` (token `7`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Produces: `export default fireballsLayer`. Pure function `mapFireballRow(fields, row)` → `{ id, dateMs, energyKt, impactEnergyKt, lat, lon, altitudeKm, velocityKmS }` or `null`.

### API facts (verified live 2026-08-30)

`GET https://ssd-api.jpl.nasa.gov/fireball.api?date-min=<90 days ago, YYYY-MM-DD>&limit=200` — no key. Response: `{ signature, count, fields: ["date","energy","impact-e","lat","lat-dir","lon","lon-dir","alt","vel"], data: [[...row values as strings, some null...], ...] }` — note it's a **fields+rows** shape, not objects; you must zip `fields` with each `data` row. `lat`/`lon` are unsigned magnitudes with a separate `lat-dir` (`"N"`/`"S"`)/`lon-dir` (`"E"`/`"W"`) sign column — **apply the sign yourself** (`S` and `W` negate the magnitude). `alt`/`vel` are frequently `null`.

### Steps

- [ ] **Step 1: Write `mapFireballRow` in `src/data/fireballs.js`**

  ```js
  export function mapFireballRow(fields, row) {
    if (!Array.isArray(fields) || !Array.isArray(row)) return null;
    const get = (key) => row[fields.indexOf(key)];
    const num = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
    let lat = num(get('lat'));
    let lon = num(get('lon'));
    if (lat === null || lon === null) return null;
    if (get('lat-dir') === 'S') lat = -lat;
    if (get('lon-dir') === 'W') lon = -lon;
    const dateStr = get('date');
    return {
      id: `${dateStr}:${lat}:${lon}`,
      dateMs: dateStr ? Date.parse(dateStr.replace(' ', 'T') + 'Z') : null,
      energyKt: num(get('energy')),
      impactEnergyKt: num(get('impact-e')),
      lat, lon,
      altitudeKm: num(get('alt')),
      velocityKmS: num(get('vel')),
    };
  }
  ```

- [ ] **Step 2: Write the proxy plugin in `vite.config.js`**

  Mirror `spaceWeatherProxy`, `TTL_MS = 5 * 60 * 1000`. Compute `date-min` server-side as `new Date(Date.now() - 90*86400000).toISOString().slice(0,10)` (fresh on every cache refresh, not baked into a constant). Fetch, zip fields+rows with the same mapping logic duplicated server-side (per this batch's pattern), serve `/api/fireballs` as `{ fireballs: [...mapped...], retrievedAt }`.

- [ ] **Step 3: Write the rest of `src/data/fireballs.js`**

  Mirror `earthquakes.js` lifecycle. `id: 'fireballs'`, `name: 'Fireballs (NASA/JPL CNEOS)'`, `icon: '☄️'`, `source: 'NASA/JPL Center for Near-Earth Object Studies'`, `updateInterval: 300000`. Static point sized by `energyKt` (log scale, mirroring earthquakes' `Math.pow(2, mag)` radius idea but for energy — e.g. `baseRadius = Math.sqrt(Math.max(energyKt, 0.01)) * 20000`), colored bright yellow/white. `mapAnalystRecord` maps the same fields.

- [ ] **Step 4: Write `src/data/fireballs.test.mjs`**

  ```js
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mapFireballRow } from './fireballs.js';

  const FIELDS = ['date', 'energy', 'impact-e', 'lat', 'lat-dir', 'lon', 'lon-dir', 'alt', 'vel'];

  test('mapFireballRow: applies S/W sign to unsigned lat/lon magnitudes', () => {
    const row = ['2026-08-15 07:32:40', '3.9', '0.13', '4.0', 'N', '115.4', 'W', '37.0', null];
    const r = mapFireballRow(FIELDS, row);
    assert.equal(r.lat, 4.0);
    assert.equal(r.lon, -115.4);
    assert.equal(r.energyKt, 3.9);
    assert.equal(r.altitudeKm, 37.0);
    assert.equal(r.velocityKmS, null);
  });

  test('mapFireballRow: N/E stays positive', () => {
    const row = ['2026-08-01 17:43:48', '2.9', '0.1', '19.5', 'S', '176.2', 'E', '45.0', null];
    const r = mapFireballRow(FIELDS, row);
    assert.equal(r.lat, -19.5);
    assert.equal(r.lon, 176.2);
  });

  test('mapFireballRow: missing lat or lon returns null', () => {
    assert.equal(mapFireballRow(FIELDS, ['2026-01-01', '1', '1', null, 'N', '1', 'E', null, null]), null);
  });

  test('mapFireballRow: null numeric fields stay null, never NaN', () => {
    const row = ['2026-08-14 07:48:36', '3.8', '0.13', '47.7', 'N', '119.4', 'W', '30.0', '12.2'];
    const r = mapFireballRow(FIELDS, row);
    for (const v of Object.values(r)) assert.notEqual(v, undefined);
    if (typeof r.velocityKmS === 'number') assert.ok(Number.isFinite(r.velocityKmS));
  });
  ```

  Plus standard lifecycle/analyst-record tests.

- [ ] **Step 5–7: Register.** `layerState.js` token `7`, id `fireballs` (sorts after `fire-perimeters`, before `flights`). Credit:

  ```js
  {
    key: 'cneos-fireball',
    html:
      'Fireball/bolide detections: ' +
      '<a href="https://cneos.jpl.nasa.gov/fireballs/" target="_blank" rel="noopener">NASA/JPL CNEOS Fireball Data API</a> ' +
      '(US public domain)',
  },
  ```

  DATA_SOURCES.md row:

  ```
  | **NASA/JPL CNEOS Fireball API** | Recent fireball/bolide atmospheric detections | US public domain | "NASA/JPL CNEOS Fireball Data API" |
  ```

- [ ] **Step 8: Run tests, verify, commit**

---

## Task 8: Space Weather panel enrichment (DONKI + NeoWs + NOAA scales)

**Files:**
- Modify: `vite.config.js` (extend the existing `spaceWeatherProxy`'s `refreshUpstream`/merge logic — do not create a new route)
- Modify: `src/data/spaceWeather.js` (extend the panel data shape + `getStats()`/analyst records; find and read this file in full first — it is the client counterpart to `spaceWeatherProxy` and is not yet covered by this plan's earlier reading)
- Modify: `src/data/spaceWeather.test.mjs`
- Modify: `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Extends whatever `spaceWeather.js` currently exposes (read it first) with three new fields on its stats/panel object: `solarEvents: Array<{id, type, issuedMs, summary, url}>`, `closeApproaches: Array<{id, name, missDistanceKm, velocityKmS, diameterMinM, diameterMaxM, hazardous, closeApproachMs}>`, `radioBlackoutScale: {scale: string, text: string}|null`.

### API facts (verified live 2026-08-30)

**DONKI notifications** — `GET https://api.nasa.gov/DONKI/notifications?startDate=<7 days ago>&endDate=<today>&type=CME,FLR&api_key=DEMO_KEY` (`DEMO_KEY` confirmed working; if the repo already has an `import.meta.env`-style key convention for other NASA-family sources, check `.env.example` and reuse the same variable-naming convention, falling back to `DEMO_KEY` when unset — mirror however `LAUNCH_LIBRARY`/other optional-key sources in `vite.config.js` already do this, do not invent a new pattern). Returns an array of `{ messageType: "CME"|"FLR", messageID, messageIssueTime (ISO), messageURL, messageBody (long text — extract just the first "## Summary:" paragraph, or the first ~200 chars, for a panel-sized string) }`.

**NeoWs feed** — `GET https://api.nasa.gov/neo/rest/v1/feed?start_date=<today>&end_date=<today>&api_key=DEMO_KEY`. Returns `{ near_earth_objects: { "<date>": [ { id, name, estimated_diameter: {meters: {estimated_diameter_min, estimated_diameter_max}}, is_potentially_hazardous_asteroid, close_approach_data: [{ close_approach_date_full, epoch_date_close_approach, relative_velocity: {kilometers_per_second}, miss_distance: {kilometers} }] } ] } }` — flatten the single day's array, take the first `close_approach_data` entry per object (there is exactly one for a single-day query). These have **no Earth surface coordinate** — this is why Task-list scoping put them in the panel, not on the globe.

**NOAA scales** — `GET https://services.swpc.noaa.gov/products/noaa-scales.json` (already effectively the same provider as the existing `noaa-swpc` credit — no new credit needed). Returns an object keyed `"0"`..`"3"` (today, day+1, day+2, day+3); `"0".R` is today's radio-blackout scale: `{Scale: "0".."5"|null, Text: string|null}`. Use key `"0"`, field `.R`.

### Steps

- [ ] **Step 1: Read `src/data/spaceWeather.js` and `spaceWeatherProxy` (in `vite.config.js`) in full** to learn the current response/panel shape before extending either — this task modifies existing, working code, so understand the current contract completely before touching it (do not break the existing aurora/K-index behavior).

- [ ] **Step 2: Extend `spaceWeatherProxy`'s upstream fetch**

  Add two more URLs (DONKI notifications, NeoWs feed) and the NOAA scales URL to the existing `Promise.allSettled` fan-out (it already fetches 2 URLs for aurora+Kp; extend to 5). Each additional source failing independently must not blank the existing aurora/Kp data — mirror the existing per-source null-safety in the merge step exactly. Map DONKI messages to `{id: messageID, type: messageType, issuedMs: Date.parse(messageIssueTime), summary: <first ~200 chars of messageBody's Summary section>, url: messageURL}`, cap at 20, newest first. Map NeoWs to `{id, name, missDistanceKm: Number(...), velocityKmS: Number(...), diameterMinM, diameterMaxM, hazardous: is_potentially_hazardous_asteroid, closeApproachMs: epoch_date_close_approach}`, cap at 20, sorted by `missDistanceKm` ascending (closest first — the interesting ones). Map NOAA scales to `{scale: data['0'].R.Scale, text: data['0'].R.Text}` or `null` if the key/shape is missing.

- [ ] **Step 3: Extend `src/data/spaceWeather.js`**

  Add `solarEvents`, `closeApproaches`, `radioBlackoutScale` to whatever object `getStats()` (or the panel-rendering path) currently returns, following the exact null-safety/JSON-safety discipline used for the existing aurora/Kp fields in this same file.

- [ ] **Step 4: Extend `src/data/spaceWeather.test.mjs`**

  Add tests asserting the three new fields parse correctly from a synthetic merged proxy payload, are `[]`/`null` (never `undefined`) when absent, and that the existing aurora/Kp tests still pass unmodified (this task must not regress Task-independent existing behavior — this is a shared-file edit, run the **full** existing test file, not just new tests, before committing).

- [ ] **Step 5: Update `DATA_SOURCES.md` and `dataCredits.js`**

  Add two new credit entries (DONKI and NeoWs are NASA, not NOAA — separate from the existing `noaa-swpc` credit which stays as-is and also now covers the NOAA-scales addition, no new credit needed for that one):

  ```js
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
  ```

  DATA_SOURCES.md rows (under Live sources, near the existing `NOAA Space Weather Prediction Center` row):

  ```
  | **NASA DONKI** | Recent solar CME/flare event notifications (space-weather panel) | US public domain | "NASA DONKI" |
  | **NASA NeoWs** | Near-Earth asteroid close approaches for today (space-weather panel) | US public domain | "NASA NeoWs — Near Earth Object Web Service" |
  ```

- [ ] **Step 6: Run the full `spaceWeather.test.mjs`, verify, commit**

---

## Task 9: Satellites panel enrichment (ISS crew via Open Notify)

**Files:**
- Modify: `vite.config.js` (new small `issCrewProxy` — separate tiny route, not worth folding into `spaceWeatherProxy` since it's Earth-orbit/satellites-themed, not solar)
- Modify: `src/data/satellites.js` (read in full first, same reasoning as Task 8)
- Modify: `src/data/satellites.test.mjs`
- Modify: `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- Extends `satellites.js`'s stats/panel object with `issCrew: Array<{name, craft}>` (or `[]` if unavailable).

### API facts (verified live 2026-08-30)

`GET http://api.open-notify.org/astros.json` — no key. **HTTP, not HTTPS** — fetch it server-side only (never from the browser, both for mixed-content reasons and because this app already proxies everything else); the proxy re-serves it over the app's own HTTPS origin. Returns `{ people: [{craft: "ISS"|"Tiangong"|..., name: "..."}], number, message: "success" }`. **Filter to `craft === 'ISS'`** — this app tracks the ISS specifically (via CelesTrak TLEs in the existing satellites layer); Tiangong crew are a different spacecraft this app doesn't track.

This changes rarely (crew rotations are weeks/months apart) — cache with a long TTL, `updateInterval: 3600000` (1 hour) client-side, server TTL 1 hour too.

### Steps

- [ ] **Step 1: Read `src/data/satellites.js` in full** to learn its current stats/panel shape before extending it.

- [ ] **Step 2: Write a small proxy plugin `issCrewProxy` in `vite.config.js`**

  `TTL_MS = 60 * 60 * 1000`. Fetch `http://api.open-notify.org/astros.json`, filter `people` to `craft === 'ISS'`, map to `{name, craft}`, serve `/api/iss-crew` as `{ crew: [...], retrievedAt }`. On upstream failure, serve-stale per the established pattern; if there's no cache at all yet, serve `{ crew: [], retrievedAt: null }` rather than a 503 — this is a nice-to-have enrichment, not core data, and a blank crew list should never break the satellites layer's init.

- [ ] **Step 3: Extend `src/data/satellites.js`**

  Add an `issCrew` field to its stats object, fetched from `/api/iss-crew` on the layer's own `updateInterval` cadence (or a separate slower interval if `satellites.js` already has a faster cadence for orbital positions — do not force ISS position updates and crew-roster fetches onto the same interval if position needs to refresh faster; read the existing `updateInterval` before deciding).

- [ ] **Step 4: Extend `src/data/satellites.test.mjs`**

  Add a test asserting `issCrew` parses from a synthetic `/api/iss-crew` response and defaults to `[]` (never `undefined`) when the fetch fails or the field is absent. Run the **full** existing test file, not just the new test, since this is a shared-file edit.

- [ ] **Step 5: Update `DATA_SOURCES.md` and `dataCredits.js`**

  ```js
  {
    key: 'open-notify',
    html:
      'ISS crew roster: ' +
      '<a href="http://open-notify.org" target="_blank" rel="noopener">Open Notify</a>',
  },
  ```

  ```
  | **Open Notify** | ISS crew roster (satellites panel) | Free public API, no key | "Open Notify" |
  ```

- [ ] **Step 6: Run the full `satellites.test.mjs`, verify, commit**

---

## Final integration check (do this once, after all 9 tasks land)

- [ ] Run the project's full test suite (`npm test`) once — confirm no cross-task regressions (shared-file edits in Tasks 1/4/8/9 are the highest-risk spots for a collision if tasks landed out of order).
- [ ] Run `node -e "require('./src/data/layerState.js')"` equivalent (or just start the dev server) and confirm `validateLayerStateRegistry()` doesn't throw at import time — it runs automatically at module load (see the bottom of `layerState.js`), so a duplicate token or malformed id from any task will crash the app on boot, not just fail a test.
- [ ] Start the dev server, open the app, and toggle each of the 7 new layers + inspect the space-weather and satellites panels for the 2 enrichments — confirm real markers/data appear (not just "no errors in console").
- [ ] Confirm the "Data attribution" popover (bottom-left credit lightbox) lists every new credit added across all 9 tasks.
