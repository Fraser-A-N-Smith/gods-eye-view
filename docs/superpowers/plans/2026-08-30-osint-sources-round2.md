# New OSINT Data Sources — Research Findings & Implementation Plan (Round 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement Part 3 task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Context:** This is the second research pass over candidate OSINT data sources for God's Eye View, following the first batch merged 2026-08-30 (`docs/superpowers/plans/2026-08-30-new-osint-sources.md`: Global Hazards, Volcanoes, Ocean Buoys, Ham Radio Propagation, Critical Infrastructure, Border Wait Times, Fireballs, plus Space Weather/Satellites enrichments). That batch, plus everything already documented in `DATA_SOURCES.md`, is the baseline this research explicitly avoided duplicating.

**Method:** Three parallel research agents independently investigated (1) network/infrastructure/signals-intelligence sources, (2) earth-science/environmental/biological sources, and (3) aviation/space/maritime sources, each required to verify via live web search that a candidate's API is real, currently documented, and not paywalled/scrape-only before recommending it. Direct `WebFetch` to most government/API domains (celestrak.org, *.noaa.gov, *.jpl.nasa.gov, *.usgs.gov, ssd-api.jpl.nasa.gov) is **blocked by this session's network egress policy**, so exact JSON field names below are drawn from documentation pages, third-party integration writeups, and cached search snippets — not raw response inspection. Every task in Part 3 is marked with a confidence level and **the implementing engineer must do one live request against the real endpoint before writing the mapping function**, exactly as the CBP task in the round-1 plan already required for its coordinate lookup.

---

## Part 1: Research findings (all candidates investigated)

### Strong recommend

| Source | Domain | What it is | Why it's unconventional for GEV |
|---|---|---|---|
| **IODA** (CAIDA/Georgia Tech) | Network | Country/region/ASN-level internet-outage alerts, derived from BGP + active probing + darknet traffic | GEV has no internet-infrastructure-health layer at all — this is a live "is a country's internet down" signal |
| **OONI** (Open Observatory of Network Interference) | Network | Per-measurement and aggregated censorship/blocking events by country | Pairs with IODA — outages vs. deliberate interference are different signals worth distinguishing |
| **EPA RadNet** (via Envirofacts) | Network/hazard | ~140 fixed US gamma-radiation monitors, near-real-time counts, real lat/lon | Keyless, live, public-domain — an "ambient radiation" ground-truth layer nothing else in GEV covers |
| **USGS Water Services** (streamflow/gauge height) | Earth science | ~10,000+ live US river/stream gauges, 15-min cadence | Hydrological — GEV has earthquakes, volcanoes, fires, storms, but nothing about rivers/floods at the gauge level |
| **NOAA Coral Reef Watch** | Earth science | Global reef "virtual station" grid — SST, Degree Heating Weeks, bleaching alert level 0–4 | A slow-building climate-stress "watch" layer, same narrative shape as the volcano layer |
| **US Drought Monitor** | Earth science | Weekly D0–D4 severity polygons, US | First *classified-severity polygon* layer (vs. point alerts) |
| **AirNow** (EPA) | Earth science | Real-time AQI, ~2,500+ US/CA/MX stations | Free key, 500 req/hr, well documented, nothing like it in GEV today |
| **NASA JPL Sentry** | Space | Standing asteroid-impact-risk table (Palermo/Torino scale) | Distinct from the NeoWs *close-approach* feed already integrated — this is long-term risk, not today's flybys |
| **CelesTrak decaying-object feed** | Space | Satellites/debris with imminent reentry | GEV already speaks CelesTrak's GP/TLE format for the main satellites layer — near-zero marginal integration cost |
| **NOAA SWPC real-time solar wind** (DSCOVR/ACE) | Space | Continuous in-situ plasma density/speed + IMF Bz/Bt, ~1-min cadence | DONKI/NeoWs (already integrated) are discrete *event* notifications; this is continuous measurement — a live "solar wind now" gauge |
| **Global Fishing Watch SAR + VIIRS night-light detections** | Maritime | Radar- and night-light-detected vessels cross-checked against AIS, surfacing vessels with **no transponder** | The single most distinctly "OSINT" find of this pass — GFW states >85% of VIIRS-detected fishing vessels never broadcast AIS. GEV already has an optional BYOK GFW integration (`vessel-events`, CC BY-NC 4.0 already accepted) to extend |

### Worth considering (real, but caveated)

- **Cloudflare Radar** (BGP hijacks, outage annotations) — real, well-documented API, but **CC BY-NC 4.0** and requires a free Cloudflare account + token (not keyless). Good fallback/companion to IODA if IODA proves too coarse.
- **GPSJam.org** (GPS/GNSS jamming heatmap) — visually verified live, but **no documented public API** (undocumented internal endpoints on a single-maintainer Express app), and its underlying data comes from ADS-B Exchange, whose ToS restricts bulk redistribution. Contact the maintainer before building on it; do not scrape.
- **bgp.tools** — real BGP table dumps, but no formal ToS/API for automated bulk use; maintainer asks for direct email contact first.
- **PeeringDB** — real, documented, free API for IXP/facility/network points with real coordinates. Static topology, not a live signal — a minor future add-on to the critical-infrastructure layer, not a new intelligence layer.
- **OpenAQ** — global AQI complement to AirNow's US/CA/MX-only coverage. Free key, "generous" but not precisely documented rate limit.
- **SNOTEL / USDA AWDB REST API** — real, keyless, Swagger-documented; ~900 western-US snowpack/SWE stations. Genuinely novel (water-supply forecasting) but very US-regional.
- **FAO Desert Locust Watch (Locust Hub)** — real ArcGIS REST/GeoJSON feed, but event-driven and regionally sparse (E. Africa/Middle East/S. Asia) — often empty.
- **EDDMapS invasive species** — real live GeoJSON feed via ArcGIS hub, 8.7M+ records, but crowdsourced occurrence reports, not sensor data — uneven density.
- **Raspberry Shake public seismic network** — real FDSN web service (`data.raspberryshake.org/fdsnws/`), keyless; best used as a citizen-seismograph *station map* (thousands of points) rather than raw miniSEED waveforms, which need real seismology tooling to render.
- **NOAA DART tsunami buoys** — real and live, but served from the *same* NDBC platform GEV's `ocean-buoys` layer already integrates. Cheap future extension (a DART-type filter/badge on the existing layer), not a new source.
- **FAA TFR polygons** — no official bulk API (the one community npm wrapper was archived/deleted in Dec 2025); usable only via a maintained third-party GeoJSON mirror (e.g. `airframesio/data`). Genuinely valuable (real airspace-restriction geometry) but built on unofficial, fragile infrastructure.
- **Aerospace Corporation CORDS reentry predictions** — real and authoritative for high-profile uncontrolled reentries, but published as blog posts/maps, no public API. Manual/curated overlay only, not a feed.

### Not viable (verified and rejected)

- **RIPEstat / RIPE RIS** — real, keyless BGP API, but **ToS explicitly prohibits repackaging/redistributing RIPEstat data**; commercial/public redistribution needs RIPE NCC's written permission first.
- **PowerOutage.us** — outage data is a **paid enterprise product**; the free map is scrape-only and scraping violates their ToS as a data vendor.
- **National Response Center (NRC)** — no real-time API; only periodic bulk Excel exports or FOIA, with unreliable free-text (non-geocoded) locations.
- **NUFORC / FAA UAS sightings** — no official API for either; NUFORC is third-party scrapes of stale, unverifiable narrative reports; FAA UAS sightings are static quarterly PDF/Excel reports, not a feed.
- **BirdCast** (Cornell) — no public API found; Live Migration Maps are WMS-style radar-composite image tiles with no documented JSON endpoint for migration-rate values.
- **NSIDC sea ice extent** — no true real-time API, only periodic flat-file/CSV downloads of an aggregate (non-point) trend number — not spatially interesting for a point-based globe.
- **Harmful Algal Bloom forecasts** (NOAA NCCOS/HABSOS) — real but only for a handful of regions (Lake Erie, FL, TX, Gulf/Great Lakes), delivered mostly as imagery/GIS layers, not a unified API.
- **LiveATC.net** — no public station-directory API, and its Terms of Use explicitly forbid using the audio streams "in any third-party products" — forecloses the Radio-Browser-style pattern GEV wanted to mirror.
- **ADS-B Exchange** — ToS bars bulk export/redistribution and paid RapidAPI access is the only sanctioned route; **redundant** anyway — `adsb.lol` (already integrated, ODbL-open, free) is API-compatible and covers the same military/MLAT ground.
- **IMB Piracy Reporting Centre** — a live map exists but with no documented API/GeoJSON endpoint (private backend); would require reverse-engineering undocumented calls.
- **ReCAAP** — publishes incident reports only as PDFs; no open feed.
- **MarineTraffic / VesselFinder** — confirmed paid/credit-based (MarineTraffic dropped its free vessel-history tier in 2023); redundant with the AISStream.io + GFW sources already integrated.

---

## Part 2: Architecture constraint discovered — the layer-toggle token budget is nearly exhausted

`src/data/layerState.js`'s `LAYER_STATE_REGISTRY` validator (`validateLayerStateRegistry`) requires every layer's `token` to match `/^[a-z0-9]$/` and be unique — a **single lowercase letter or digit**, 36 possible values total. As of this research pass, **33 of 36 are already assigned** (all 26 letters `a`–`z`, plus digits `1`–`7` from round 1). Only **`0`, `8`, `9`** remain free.

This caps Part 3 at **three new toggleable layers**, full stop, without a breaking change to the token scheme (e.g. moving to two-character tokens, which would touch the keyboard-shortcut UI, persisted layer-state strings, and every existing single-char reference — out of scope here). This plan spends the three remaining tokens on the three strongest "strong recommend" candidates that need their own toggle (Internet Outages, Radiological Monitoring, Dark Fleet Detections) and folds the other three "strong recommend" candidates (NASA Sentry, CelesTrak decay, NOAA real-time solar wind) into **existing** panels as enrichments — the same pattern round 1 used for DONKI/NeoWs/ISS-crew, which needed no new token because they enrich the existing `space-weather` and `satellites` toggles rather than adding new ones.

**If a future round wants more toggle layers than this leaves room for** (USGS Water Services, NOAA Coral Reef Watch, US Drought Monitor, AirNow, and everything in "worth considering" above all remain unclaimed candidates), the token scheme itself needs to be revisited first — flag this to the user/maintainer rather than silently reusing or squeezing tokens.

---

## Global constraints (Part 3)

- No paid tiers, no signup-with-billing keys. `GFW_API_TOKEN` (free registration, already an established optional BYOK pattern in this codebase) and `AIRNOW`-style free-registration keys are acceptable as *optional* enrichments only if truly needed — none of the three chosen new layers below require a key.
- Every new Cesium entity uses **static** properties (no per-frame `CallbackProperty`) — these are all small, infrequently-updated datasets. None of these layers may call `holdContinuousRender`.
- Every new proxy route reuses the existing `coalesceProxyRequest` helper and rate-limiter/cache helpers already defined in `vite.config.js` — grep for `spaceWeatherProxy`/`vesselEventsProxy` before writing a task's route.
- **Live-verify before coding.** Because this research session could not `WebFetch` raw JSON from most of these domains (network egress policy), every task below states a confidence level. Any task marked *(needs live verification)* requires the implementing engineer to make one real request against the documented endpoint and confirm field names/shape before writing the mapping function — do not hand-type a schema from a search-snippet paraphrase.
- Token assignment (alphabetically ordered by `id`, `disposition: 'enabled-only'`):

  | id | token | insertion point |
  |---|---|---|
  | `dark-fleet-detections` | `0` | after `critical-infrastructure`, before `earthquakes` |
  | `internet-outages` | `8` | after `ham-radio-propagation`, before `local-dams` |
  | `radiation-monitoring` | `9` | after `opensnowmap-pistes`, before `radio` |

  (Verified against the live `LAYER_STATE_REGISTRY` 2026-08-30: every letter `a`–`z` and digits `1`–`7` taken; `0`/`8`/`9` free. Re-check before each task — another task in this plan may have landed first.)
- Every task ends with: the new/changed files pass `npm test -- <touched test files>`, and a git commit.

---

## Task 1: Internet Outages & Censorship layer (IODA + OONI merged)

**Files:**
- Create: `src/data/internetOutages.js`, `src/data/internetOutages.test.mjs`
- Create: `config/country_centroids.json` (small bundled lookup — see below)
- Modify: `vite.config.js` (new `internetOutagesProxy`, mirrors `globalHazardsProxy`'s two-upstream merge pattern from round 1)
- Modify: `src/main.js`, `src/data/layerState.js` (token `8`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Why a merge, not two layers:** Round 1 already established the precedent (Global Hazards = GDACS + EONET under one toggle). Outages (IODA) and deliberate censorship (OONI) are different mechanisms but the same "is this country's internet reachable/free" story, and a second token isn't available anyway.

### The country-coordinate problem

Neither IODA nor OONI's aggregate endpoints return lat/lon — both key by country/ASN code. GEV has no bundled country-centroid dataset (`src/data/local_data/natural_earth/` has physical-geography *regions*, not country boundaries). This task needs a small bundled lookup, **`config/country_centroids.json`**, mapping ISO alpha-2 → `{name, lat, lon}` for ~200 countries — same shape/effort as round 1's `config/cbp_port_locations.json`. Source it from Natural Earth's Admin-0 country centroids (public domain, consistent with the already-bundled `natural_earth/` folder's provenance) or an equivalent public-domain centroid table; **the implementing engineer must spot-check a sample of entries against an independent source before committing**, same rigor the CBP task required.

### API facts *(needs live verification — IODA and OONI docs pages were reachable via search, but exact field names were not confirmed from a raw response in this session)*

**IODA** — `GET https://api.ioda.caida.org/v2/outages/alerts?...` (keyless REST, OpenAPI/Swagger-documented at the same host). Best-understood shape from docs: alerts carry `entityType` (e.g. `"country"`), `entityCode` (ISO code), `datasource` (e.g. `"bgp"`, `"ping-slash24"`, `"gtr"`), `from`/`until` (unix seconds), and a severity/level field. Confirm the exact alert-list endpoint path and field names live (try `/v2/outages/alerts?entityType=country&from=<now-86400>&until=<now>`) before writing `mapIodaAlert`.

**OONI** — `GET https://api.ooni.io/api/v1/aggregation?...` (keyless, OpenAPI-documented at `api.ooni.io`). Returns per-country/per-day aggregate counts of measurements and `anomaly_count`/`confirmed_count` (blocking confirmed vs. suspected). Confirm exact query params (probe_cc, since/until, axis_x) and response field names live before writing `mapOoniAggregate`.

### Steps

- [ ] **Step 1:** Build `config/country_centroids.json` (ISO alpha-2 → `{name, lat, lon}`), spot-checked per the note above.
- [ ] **Step 2:** Live-verify both APIs' exact endpoint paths and field names (see above); update this task's API-facts section with what you found before writing code.
- [ ] **Step 3:** Write `internetOutagesProxy` in `vite.config.js` mirroring `globalHazardsProxy`: `Promise.allSettled` both upstreams (one down must not blank the other), map each alert/aggregate row to `{id, source: 'IODA'|'OONI', countryCode, countryName, lat, lon, kind, score, dateMs}` via the country-centroid lookup (drop rows with no centroid match), cap merged records, 5-minute TTL, serve `/api/internet-outages` as `{outages: [...], retrievedAt}`.
- [ ] **Step 4:** Write `src/data/internetOutages.js` mirroring `earthquakes.js`/`globalHazards.js` lifecycle. `id: 'internet-outages'`, `name: 'Internet Outages & Censorship (IODA + OONI)'`, `icon: '🌐'`, `source: 'CAIDA IODA / OONI'`, `updateInterval: 300000`. Static point + label per country, sized/colored by severity/anomaly score. `mapAnalystRecord` maps the merged shape, null-not-undefined, JSON-safe.
- [ ] **Step 5:** Write `src/data/internetOutages.test.mjs` mirroring `globalHazards.test.mjs`'s test list (record mapping, missing-field discipline, JSON-safety, lifecycle with mocked fetch, error/recovery), plus a test asserting `config/country_centroids.json` parses and every entry has finite lat/lon in valid ranges.
- [ ] **Step 6:** Register: `main.js` import + `dataManager.register`; `layerState.js` token `8`; `dataCredits.js` entries for both `ioda` and `ooni` (courtesy citation — neither publishes a hard attribution requirement, but both are academic/nonprofit projects worth crediting); `DATA_SOURCES.md` rows for both.
- [ ] **Step 7:** Run tests, verify against the live dev server, commit.

---

## Task 2: Radiological Ambient Monitoring layer (EPA RadNet)

**Files:**
- Create: `src/data/radiationMonitoring.js`, `src/data/radiationMonitoring.test.mjs`
- Modify: `vite.config.js` (`radiationMonitoringProxy`, mirrors `spaceWeatherProxy`), `src/main.js`, `src/data/layerState.js` (token `9`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:** `export default radiationMonitoringLayer`. Pure function `mapRadnetRow(row)` → `{id, stationName, lat, lon, gammaCountRate, sampleDateMs, state}` or `null`.

### API facts *(needs live verification)*

EPA's Envirofacts Data Service (`enviro.epa.gov`/`data.epa.gov`) exposes RadNet via the `RAD_*` tables under the `efservice` REST convention: `GET https://data.epa.gov/efservice/RAD_FACILITY/rows/0:200/JSON` for station metadata (name, state, lat/lon) and a companion results table (likely `RAD_ALPHA_RESULT` or similar — confirm the exact current table name against `https://enviro.epa.gov/enviro/ef_metadata_html.ef_metadata_table?p_table_name=RAD_FACILITY&p_topic=RADNET`) for the latest gamma count readings, joined by facility ID. Keyless, no documented rate limit, public-domain US government data (Envirofacts' `efservice` output format defaults to JSON). **Confirm the exact table names, join key, and whether lat/lon lives on the facility row or a separate geo table before writing the mapping function** — this wasn't confirmed from a raw response in this session.

### Steps

- [ ] **Step 1:** Live-verify the RadNet table names/join and a sample JSON row's exact fields.
- [ ] **Step 2:** Write `radiationMonitoringProxy` in `vite.config.js`: fetch facility metadata + latest readings, join server-side, filter to stations with a finite lat/lon and a reading within the last 30 days (RadNet stations don't all report continuously), cap at 200 records (there are only ~140 stations, so this is generous headroom), 1-hour TTL (station network changes rarely, readings update periodically not by the minute), serve `/api/radiation-monitoring` as `{stations: [...mapped...], retrievedAt}`.
- [ ] **Step 3:** Write `src/data/radiationMonitoring.js` mirroring `earthquakes.js`. `id: 'radiation-monitoring'`, `name: 'Ambient Radiation Monitoring (EPA RadNet)'`, `icon: '☢️'`, `source: 'EPA RadNet'`, `updateInterval: 3600000`. Static point + label showing count rate; color by a documented normal-background band vs. elevated (RadNet publishes typical background ranges per station type — use a conservative, clearly-labeled "elevated vs. typical" two-band scheme, not an alarm-red scheme that could misread routine background variation as a hazard; the status text must say these are ambient background readings, not an alert feed).
- [ ] **Step 4:** Write `src/data/radiationMonitoring.test.mjs` mirroring the earthquakes test list (record mapping, missing-field/`null` discipline, JSON-safety, lifecycle with mocked fetch, error/recovery, color-band boundary test).
- [ ] **Step 5:** Register: `main.js`, `layerState.js` token `9`, `dataCredits.js` entry:
  ```js
  {
    key: 'epa-radnet',
    html:
      'Ambient radiation monitoring: U.S. EPA RadNet — ' +
      '<a href="https://www.epa.gov/radnet" target="_blank" rel="noopener">epa.gov/radnet</a> ' +
      '(US public domain)',
  },
  ```
  `DATA_SOURCES.md` row: `| **EPA RadNet** | Ambient gamma radiation monitoring (US fixed station network) | US public domain | "U.S. EPA RadNet" |`
- [ ] **Step 6:** Run tests, verify, commit.

---

## Task 3: Dark Fleet Detections layer (GFW SAR + VIIRS night-light) — scoping required

**This task is less certain than Tasks 1–2 and may need re-scoping at implementation time.**

**Files:**
- Create: `src/data/darkFleetDetections.js`, `src/data/darkFleetDetections.test.mjs`
- Modify: `vite.config.js` (new preset/route alongside `vesselEventsProxy`), `src/main.js`, `src/data/layerState.js` (token `0`), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:** `export default darkFleetDetectionsLayer`. Pure function `mapSarDetection(row)` → `{id, lat, lon, matched, detectionDateMs, vesselLengthM}` or `null`.

### What's confirmed vs. not

Confirmed (via GFW's own platform-update posts, `api-doc.globalfishingwatch.org`): GFW's current API version is v3; a **Vessel Detections dataset from Sentinel-1 SAR** was added to the platform in 2024, distinguishing "matched" (AIS-corroborated) from "unmatched" (dark-target) detections — the latter is exactly the "gods-eye" signal this task wants. GFW also runs a VIIRS night-light detection product (via the Skylight partnership).

**Not confirmed:** whether SAR/night-light detections are queryable through the same `v3/events?datasets[0]=...` shape `vesselEventsProxy` already uses (a simple GET+dataset-id, which would make this a near-drop-in preset addition), or only through the separate **4Wings API** (`/v3/4wings/report`), which takes a POST body with a region geometry and returns tile/raster or report data — a materially different request shape requiring its own proxy logic, not a preset extension.

### Steps

- [ ] **Step 1:** Before writing any code, check `https://api-doc.globalfishingwatch.org/` for the current dataset catalog. If a SAR-detections dataset id exists under the **Events API** (same family as `public-global-fishing-events:latest` etc. already used in `vesselEventsShape.js`), this is a straightforward new preset — follow Step 2a. If SAR/night-light detections are **only** available via the 4Wings report/tile endpoints, this needs a materially different proxy (POST + region body, likely tile-based like the existing `flowTiles.js`/RainViewer tile-overlay pattern) — follow Step 2b, and re-estimate scope before continuing; this may be better split into its own follow-up plan rather than forced into this task's shape.
- [ ] **Step 2a (Events-API path):** Add a new preset (mirror `VESSEL_EVENT_PRESETS` in `vesselEventsShape.js`) for the SAR/night-light dataset id, reusing `vesselEventsProxy`'s existing `GFW_API_TOKEN`-gated, `no_key`-503, 30-minute-TTL pattern with the same 14-day window. This is the cheap path — prefer it if it exists.
- [ ] **Step 2b (4Wings-API path):** Only if Step 1 shows no Events-API dataset. Write a new `darkFleetDetectionsProxy`: same `GFW_API_TOKEN` gate and `no_key` behavior as `vesselEventsProxy`, but issue a `POST /v3/4wings/report` (or the confirmed current endpoint) with a global or viewport-bounded region body; parse the report/tile response into point detections server-side.
- [ ] **Step 3:** Write `src/data/darkFleetDetections.js` mirroring `vesselEvents.js`'s lifecycle and its keyless-safe status text (`vesselEventsStatusText` pattern: `UNAVAILABLE · ... · KEY REQUIRED` when `GFW_API_TOKEN` is unset). `id: 'dark-fleet-detections'`, `name: 'Dark Fleet Detections (GFW SAR/VIIRS)'`, `icon: '🛰️'`, `source: 'Global Fishing Watch (CC BY-NC 4.0)'`, same 20-minute `updateInterval` as `vessel-events`. Render **unmatched** (no-AIS) detections distinctly (brighter/different color) from matched ones — matched detections corroborate the existing AIS vessel layer, unmatched ones are the actual "dark fleet" signal this layer exists for. Status text must carry the same "apparent, never confirmed" hedge `vesselEvents.js` already establishes (a SAR/night-light hit is a detection, not a confirmed vessel identity).
- [ ] **Step 4:** Write `src/data/darkFleetDetections.test.mjs` mirroring `vesselEvents.test.mjs`'s test list.
- [ ] **Step 5:** Register: `main.js`, `layerState.js` token `0`, `dataCredits.js` — **reuses** the existing `key: 'gfw'`-style credit if `vesselEvents.js` already registered one (check `dataCredits.js` before adding a duplicate), `DATA_SOURCES.md` row alongside the existing GFW vessel-events entry, noting it shares the same CC BY-NC 4.0 / optional-BYOK / 50k-req-day caveats already documented for that source.
- [ ] **Step 6:** Run tests, verify, commit.

---

## Task 4: Space Weather panel enrichment — NASA Sentry impact-risk table

**Files:** Modify `vite.config.js` (`spaceWeatherProxy` — add a third upstream fetch), `src/data/spaceWeather.js`, `src/data/spaceWeatherShape.js`, their test files, `DATA_SOURCES.md`.

**Confidence: high on the field names** (confirmed via search-indexed API documentation, though not a live raw response): `GET https://ssd-api.jpl.nasa.gov/sentry.api` (no key, same host/family as the already-integrated DONKI/NeoWs). Summary-list mode returns each risk object with fields including `des` (designation), `fullname`, `h` (absolute magnitude), `diameter`, `range` (years spanned), `n_imp` (number of potential impacts), `ip` (impact probability, cumulative), `ps_cum` (cumulative Palermo Scale), `ts_max` (max Torino Scale), `v_inf` (impact velocity), `last_obs` (last observation date). **No Earth-surface coordinate** — same reasoning DONKI/NeoWs are panel-only, not globe entities.

### Steps

- [ ] **Step 1:** Live-verify the base query URL/params for summary-list mode (likely no params, or a `days` param).
- [ ] **Step 2:** Add a third `Promise.allSettled` branch to `spaceWeatherProxy`'s upstream fetch (alongside the existing SWPC + DONKI + NeoWs branches — confirm current branch count by reading the function first), mapping the top ~20 objects by `ip` (highest risk first) into `{designation, fullname, diameter, impactProbability, palermoScale, torinoScale, velocityKmS, lastObservedDate}`. Independent-failure degrade: Sentry failing sets `impactRiskObjects: []` without affecting the aurora oval, K-index, or the existing DONKI/NeoWs fields — same pattern already documented for those two.
- [ ] **Step 3:** Add the field to `spaceWeatherShape.js`'s shaping/validation and to the Space Weather panel's render (a small "Impact Risk Watch" sub-list, same visual tier as the existing close-approaches list).
- [ ] **Step 4:** Update `spaceWeather.test.mjs`/`spaceWeatherShape.test.mjs` with mapping + independent-failure tests mirroring the existing DONKI/NeoWs ones.
- [ ] **Step 5:** Update `DATA_SOURCES.md`'s NASA DONKI/NeoWs note to also cover Sentry (same proxy, same `DEMO_KEY`/`NASA_API_KEY` story — no new credit key needed, it's the same `api.nasa.gov` family already credited).
- [ ] **Step 6:** Run tests, verify, commit.

---

## Task 5: Space Weather panel enrichment — NOAA real-time solar wind (DSCOVR/ACE)

**Files:** Modify `vite.config.js` (`spaceWeatherProxy`), `src/data/spaceWeather.js`, `src/data/spaceWeatherShape.js`, their test files, `DATA_SOURCES.md`.

**Confidence: medium-high on shape** (this is a long-stable, widely-mirrored NOAA product; exact current field order should still be confirmed live). `GET https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json` and `.../mag-7-day.json` — keyless, no signup. Format is an **array of arrays with the header as row 0** (not an array of objects): plasma rows are commonly `[time_tag, density, speed, temperature]`; mag rows are commonly `[time_tag, bx_gsm, by_gsm, bz_gsm, lon_gsm, lat_gsm, bt]`. Updated roughly every minute; for a panel gauge, only the **latest row** (last array entry) is needed, not the full 7-day series.

### Steps

- [ ] **Step 1:** Live-verify both JSON files' current header row and field order.
- [ ] **Step 2:** Add a fourth `Promise.allSettled` branch to `spaceWeatherProxy` fetching both `plasma-7-day.json` and `mag-7-day.json`, taking only the last row of each, zipping with the header row (don't hardcode column indices — read them from row 0 so a future NOAA format change fails loudly in a test rather than silently mis-mapping), producing `{solarWindSpeedKmS, solarWindDensity, imfBz, imfBt, sampledAtMs}`. Independent-failure degrade: this branch failing sets these fields to `null` without affecting the rest of the panel.
- [ ] **Step 3:** Add to `spaceWeatherShape.js` and the panel render — a compact "Solar Wind Now" readout (speed/density/Bz), distinct from the aurora oval and K-index already shown, positioned as the more "live" companion to the discrete DONKI CME/flare events.
- [ ] **Step 4:** Tests mirroring the existing space-weather field tests, plus a header-order-mismatch test (assert the mapper reads columns by header name, not position, so a NOAA format change is caught rather than silently corrupting data).
- [ ] **Step 5:** `DATA_SOURCES.md` — extend the existing NOAA SWPC row's description to mention real-time solar wind; no new credit key needed (same NOAA/SWPC attribution already registered).
- [ ] **Step 6:** Run tests, verify, commit.

---

## Task 6: Satellites panel/layer enrichment — CelesTrak decaying/reentry candidates

**Files:** Modify `src/data/satellites.js` (read the file's existing CelesTrak-group-loading code first — this task adds one more group, following the same pattern as the existing stations/visual/GPS/GLONASS/Galileo/geo groups), its test file, `DATA_SOURCES.md`.

**Confidence: high** — GEV already fetches and parses CelesTrak GP data for six groups; this is the same mechanism against `SPECIAL=DECAYING` (or `GROUP=decaying`, confirm exact query param live) rather than a new integration pattern. Standard OMM/GP JSON fields (`OBJECT_NAME`, `OBJECT_ID`, `NORAD_CAT_ID`, `EPOCH`, `MEAN_MOTION`, etc.) — the same shape already parsed elsewhere in this file.

### Steps

- [ ] **Step 1:** Read `satellites.js`'s existing group-loading code in full (how the six current groups are fetched/merged/rendered) before writing this task's diff — do not guess at helper names.
- [ ] **Step 2:** Live-verify the exact CelesTrak decaying-objects query URL and param name (`SPECIAL=DECAYING` vs `GROUP=decaying` — search results were inconclusive on which is current).
- [ ] **Step 3:** Add a seventh, optional group fetch for decaying objects. Render matching entities with a distinct marker (e.g. a small "⬇" badge or a warning-tinted point) rather than a whole separate layer — this is an *enrichment* of the existing `satellites` toggle, not a new layer, consistent with how round 1 added ISS crew without a new token.
- [ ] **Step 4:** Update `satellites.test.mjs` (or the relevant colocated test) with a mapping test for the new group and a test that decaying-object rendering doesn't regress the existing six groups.
- [ ] **Step 5:** `DATA_SOURCES.md` — extend the existing CelesTrak row's description; no new credit key needed (already credited).
- [ ] **Step 6:** Run tests, verify, commit.

---

## Summary

| Task | Type | Token | Confidence |
|---|---|---|---|
| 1. Internet Outages & Censorship (IODA+OONI) | New layer | `8` | Needs live verification (endpoint shape) |
| 2. Ambient Radiation Monitoring (EPA RadNet) | New layer | `9` | Needs live verification (table names) |
| 3. Dark Fleet Detections (GFW SAR/VIIRS) | New layer | `0` | Scoping required — may split into its own plan |
| 4. Sentry impact-risk table | Panel enrichment | none | High (documented field names) |
| 5. Real-time solar wind | Panel enrichment | none | Medium-high (stable known format) |
| 6. CelesTrak decaying objects | Panel/layer enrichment | none | High (reuses existing integration) |

This spends all three remaining single-character layer-toggle tokens. Candidates not selected here (USGS Water Services, NOAA Coral Reef Watch, US Drought Monitor, AirNow/OpenAQ, SNOTEL, FAO Locust Hub, EDDMapS, Raspberry Shake station map, PeeringDB) remain documented in Part 1 as vetted, ready candidates for **whenever the token scheme is revisited** — they were not dropped for quality reasons, only for lack of an available toggle slot.
