# New OSINT Data Sources — Research Findings & Implementation Plan (Round 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement Part 3 task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Context:** This is the second research pass over candidate OSINT data sources for God's Eye View, following the first batch merged 2026-08-30 (`docs/superpowers/plans/2026-08-30-new-osint-sources.md`: Global Hazards, Volcanoes, Ocean Buoys, Ham Radio Propagation, Critical Infrastructure, Border Wait Times, Fireballs, plus Space Weather/Satellites enrichments). That batch, plus everything already documented in `DATA_SOURCES.md`, is the baseline this research explicitly avoided duplicating.

**Method:** Three parallel research agents independently investigated (1) network/infrastructure/signals-intelligence sources, (2) earth-science/environmental/biological sources, and (3) aviation/space/maritime sources, each required to verify via live web search that a candidate's API is real, currently documented, and not paywalled/scrape-only before recommending it. Direct `WebFetch` to most government/API domains (celestrak.org, *.noaa.gov, *.jpl.nasa.gov, *.usgs.gov, ssd-api.jpl.nasa.gov) is **blocked by this session's network egress policy**, so exact JSON field names below are drawn from documentation pages, third-party integration writeups, and cached search snippets — not raw response inspection. Every task in Part 3 is marked with a confidence level and **the implementing engineer must do one live request against the real endpoint before writing the mapping function**, exactly as the CBP task in the round-1 plan already required for its coordinate lookup.

---

## Implementation status (2026-08-31)

Tasks 1, 4, and 5 are **done** — implemented, tested (3127/3127 passing), and committed on
`claude/osint-data-research-vgihuu`. Tasks 2, 3, and 6 are **deferred**, each for a concrete reason
discovered while implementing (not merely "ran out of time") — see each task's own section below for
what was actually found and what a follow-up would need:

- ✅ **Task 1 — Internet Outages & Censorship (IODA + OONI).** Both upstream shapes were re-verified
  against the providers' own spec/test source (not just search-indexed docs) before writing code — see
  the task section below.
- ✅ **Task 4 — NASA Sentry enrichment.**
- ✅ **Task 5 — NOAA real-time solar wind enrichment.**
- ⏸️ **Task 2 — EPA RadNet.** Deferred: the plan's premise was wrong. The confirmed live table
  (`ERM_RESULT`, verified against EPA's own sample client) has no coordinate field, and the real
  near-real-time gamma data is dashboard/CSV-export only, not a documented REST API.
- ⏸️ **Task 3 — GFW Dark Fleet (SAR/VIIRS).** Deferred: confirmed (via GFW's own `gfwr` R client source)
  that SAR detections are **not** reachable through the simple Events-API preset pattern this task hoped
  for — they require the 4Wings report API with a mandatory EEZ/MPA/RFMO region parameter and return CSV,
  a materially larger integration than the rest of this batch.
- ⏸️ **Task 6 — CelesTrak decaying/reentry.** Deferred on engineering judgement, not a blocked fact: the
  data fetch itself is low-risk (the existing `/api/celestrak/<group>` proxy is already fully generic), but
  `satellites.js` is the most performance/architecture-critical file in this codebase and this session has
  no way to visually verify a change there in a running browser (sandboxed, no live rendering). See the
  task section for the low-risk approach identified for whoever picks this back up.

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

### Steps — ✅ DONE (2026-08-31)

- [x] **Step 1:** Built `config/country_centroids.json` from `gavinr/world-countries-centroids` (MIT, 244 ISO alpha-2 entries), spot-checked against 12 known real-world centroids.
- [x] **Step 2:** Re-verified both shapes against the providers' own spec/test source (not search snippets): IODA against CAIDA's `ioda-api` wiki (`API-Specification.md`, cloned directly), OONI against `ooni/api`'s own `newapi/tests/integ/test_aggregation.py`. The IODA base-URL path-prefix (`/v2/`) is still unconfirmed against a live response — everything else in the response shape is now high-confidence.
- [x] **Step 3:** `internetOutagesProxy` in `vite.config.js`, mirroring `globalHazardsProxy` + `borderWaitTimesProxy`'s config-join pattern.
- [x] **Step 4:** `src/data/internetOutages.js`.
- [x] **Step 5:** `src/data/internetOutagesShape.test.mjs` + `src/data/internetOutages.test.mjs`, plus the centroid-file validity test.
- [x] **Step 6:** Registered everywhere (`main.js`, `layerState.js` token `8`, `dataCredits.js` — three entries: `ioda`, `ooni`, `country-centroids` — `DATA_SOURCES.md`).
- [x] **Step 7:** 3127/3127 tests pass. Committed (`feat: add Internet Outages & Censorship layer (CAIDA IODA + OONI)`). Not exercised against the live dev server/real upstreams — this sandbox's egress policy blocks both hosts directly.

---

## Task 2: Radiological Ambient Monitoring layer (EPA RadNet) — ⏸️ DEFERRED, plan's premise was wrong

**What was actually found (2026-08-31):** cloned EPA's own official sample client,
`github.com/USEPA/XCode-RadNet-Sample-Envirofacts-API` (linked from `developer.epa.gov`), and read its
source directly. The confirmed live Envirofacts table for RadNet is **`ERM_RESULT`** (Environmental
Radiation Monitoring — laboratory analysis results for air-filter/water/precipitation samples, queried by
`ANALYTE_ID`), not `RAD_FACILITY`/`RAD_ALPHA_RESULT` as this plan assumed. Its confirmed field list —
`ANA_NUM, RESULT_ID, ANALYTE_ID, RESULT_AMOUNT, CSU, MDC, RESULT_UNIT, RESULT_DATE, RESULT_IN_SI,
CSU_IN_SI, MDC_IN_SI, SI_UNIT` — has **no coordinate field of any kind**. Separately, EPA's own pages
confirm the near-real-time gamma-count-rate data (the actually valuable ~140-station live network this
task wanted) is served through a **dashboard** (`radnet.epa.gov/radnet-public/`) with per-location CSV
export, not a documented JSON REST API — the same "dashboard/CSV-only" shape this plan correctly rejected
for BirdCast and PowerOutage.us in Part 1.

**What a follow-up would need:** either (a) find a genuine `ERM_FACILITY`-style Envirofacts table that
joins to `ERM_RESULT` by facility ID and carries a coordinate (searched for one in this session and found
no evidence either way — the 2012-era sample app doesn't demonstrate a join), or (b) treat
`radnet.epa.gov/radnet-public/`'s CSV export as the real integration target and reverse-engineer its
request shape from a live browser session (this sandbox cannot reach the host to do that). Until one of
those is confirmed, this task should not be built — the original API-facts section below is **known
wrong** and kept only for the record.

### Original (incorrect) API facts

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

## Task 3: Dark Fleet Detections layer (GFW SAR + VIIRS night-light) — ⏸️ DEFERRED, confirmed larger than this batch

**Resolved (2026-08-31): it needs the 4Wings path (Step 2b), not the cheap Events-API preset (Step 2a) —
and 2b is bigger than this task's shape.** Cloned GFW's own R client, `github.com/GlobalFishingWatch/gfwr`,
and read `R/gfw_sar_vessel_detections.R` / `R/gfw_4wings.R` directly. SAR vessel presence is served only
through the 4Wings API (`api_endpoint = "SAR"`, `dataset_type = "sar-presence"`), which **requires** a
`region_source`/`region` parameter (an EEZ, MPA, or RFMO code, or a user-supplied shapefile — there is no
"everywhere" mode), caps the date range at 366 days, and returns **CSV** from a report generator, not a
JSON point list. There is no SAR/night-light dataset reachable through the simple
`v3/events?datasets[0]=...` shape `vesselEventsProxy` already uses.

That makes this a genuinely different integration than the rest of this batch: it needs a strategy for
enumerating which regions to query (globally, that's every coastal EEZ — hundreds of report requests, not
one), CSV parsing, and a decision about how a "global dark-fleet layer" degrades when a full-world SAR pass
isn't a single cheap request. That is real design work, not a fact any amount of research alone resolves —
it deserves its own dedicated plan rather than being forced into this task's shape. Left unbuilt here.

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

## Task 4: Space Weather panel enrichment — NASA Sentry impact-risk table — ✅ DONE (2026-08-31)

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

## Task 5: Space Weather panel enrichment — NOAA real-time solar wind (DSCOVR/ACE) — ✅ DONE (2026-08-31)

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

## Task 6: Satellites panel/layer enrichment — CelesTrak decaying/reentry candidates — ⏸️ DEFERRED, blast-radius call

**Not blocked on a missing fact — deferred on engineering judgement.** Read `vite.config.js`'s
`celestrakProxy` in full: it is already fully generic (`/api/celestrak/<any-group-name>`, `GROUP=<group>&
FORMAT=tle`, cached, single-flighted) — fetching a `decaying` group needs **zero backend changes**, just a
client call to `/api/celestrak/decaying` and the same TLE-line parsing `satellites.js` already does for its
six existing groups. The data-fetch risk here is low.

The reason this stayed unbuilt is `satellites.js` itself: it is the most performance/architecture-critical
file in this codebase (per-frame SGP4 propagation, a shared `_pointStyleFor`/`CATALOG_GROUPS`
dedupe-by-first-tag contract, click-tracking, baked orbit-ring primitives) and this sandboxed session has
no way to load it in a real browser and confirm a change doesn't regress frame rate or the tracking flow —
exactly the kind of change `earthquakes.js`'s own header comment warns cost 30fps once already, in a much
simpler layer. Shipping an unverified change to the flagship layer isn't a trade worth making blind.

**Lowest-risk approach for whoever picks this up:** don't add a 7th `CATALOG_GROUPS` entry (that touches
the propagation loop and the dedupe contract). Instead, fetch `/api/celestrak/decaying` as a **separate,
optional, post-hoc pass** after the six core groups finish loading: parse the returned TLEs for NORAD IDs
only, and for any ID that's already in `_catalog` (i.e. already being propagated/rendered as a normal
satellite), restyle its existing point/label with a small decaying badge — never create a new point, never
touch `CATALOG_GROUPS`, never affect propagation timing. An empty or failed decaying fetch changes nothing.
This keeps the six-group loading/propagation/dedupe contract completely untouched and needs verification
only of the restyle step, not the whole file's architecture — but it should still go through a real browser
before merging, not another blind pass.

**Files:** Modify `src/data/satellites.js` (read the file's existing CelesTrak-group-loading code first — this task adds one more group, following the same pattern as the existing stations/visual/GPS/GLONASS/Galileo/geo groups), its test file, `DATA_SOURCES.md`.

**Confidence: high on the fetch, unverified on the group name** — confirmed by reading `celestrakProxy` directly: it always requests `GROUP=<group>&FORMAT=tle` (plain TLE text, not JSON — this plan's original JSON-field assumption was wrong, though moot given the proxy is already generic and reusable as-is), validated by a `/^1 /m` regex on the response. `decaying` is CelesTrak's long-standing group slug for this catalog, but was not confirmed against a live response in this session — verify `https://celestrak.org/NORAD/elements/gp.php?GROUP=decaying&FORMAT=tle` returns real TLE lines before relying on it.

### Steps

- [ ] **Step 1:** Read `satellites.js`'s existing group-loading code in full (how the six current groups are fetched/merged/rendered) before writing this task's diff — do not guess at helper names.
- [ ] **Step 2:** Live-verify the exact CelesTrak decaying-objects query URL and param name (`SPECIAL=DECAYING` vs `GROUP=decaying` — search results were inconclusive on which is current).
- [ ] **Step 3:** Add a seventh, optional group fetch for decaying objects. Render matching entities with a distinct marker (e.g. a small "⬇" badge or a warning-tinted point) rather than a whole separate layer — this is an *enrichment* of the existing `satellites` toggle, not a new layer, consistent with how round 1 added ISS crew without a new token.
- [ ] **Step 4:** Update `satellites.test.mjs` (or the relevant colocated test) with a mapping test for the new group and a test that decaying-object rendering doesn't regress the existing six groups.
- [ ] **Step 5:** `DATA_SOURCES.md` — extend the existing CelesTrak row's description; no new credit key needed (already credited).
- [ ] **Step 6:** Run tests, verify, commit.

---

## Summary

| Task | Type | Token | Status |
|---|---|---|---|
| 1. Internet Outages & Censorship (IODA+OONI) | New layer | `8` | ✅ Done — shapes re-verified against providers' own spec/test source |
| 2. Ambient Radiation Monitoring (EPA RadNet) | New layer | `9` (unspent — free again) | ⏸️ Deferred — plan's premise confirmed wrong (no coordinate field exists on the real table) |
| 3. Dark Fleet Detections (GFW SAR/VIIRS) | New layer | `0` (unspent — free again) | ⏸️ Deferred — confirmed to need the larger 4Wings/region-enumeration path, own plan warranted |
| 4. Sentry impact-risk table | Panel enrichment | none | ✅ Done |
| 5. Real-time solar wind | Panel enrichment | none | ✅ Done |
| 6. CelesTrak decaying objects | Panel/layer enrichment | none | ⏸️ Deferred — low-risk approach identified, needs a live-browser pass to verify |

Tokens `9` and `0` are **still free** — Tasks 2 and 3 were not built, so only token `8` (Task 1) is actually
spent. See "Implementation status" near the top of this document for what to do next with each deferred
task. Candidates not selected here (USGS Water Services, NOAA Coral Reef Watch, US Drought Monitor,
AirNow/OpenAQ, SNOTEL, FAO Locust Hub, EDDMapS, Raspberry Shake station map, PeeringDB) remain documented in
Part 1 as vetted, ready candidates for whenever there's room for them.
