# Logistics / Rail Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 new toggleable Cesium data layers to God's Eye View from the candidates identified in `docs/research/logistics-rail-apis.md` — **OpenRailwayMap** (world rail network overlay), **Fintraffic Digitraffic** (live train GPS, Finland), and **USACE LPMS** (US inland-waterway lock/barge traffic) — all free, and all but the first keyless. Network Rail Open Data (UK) is deliberately **out of scope for this plan** (see "Deferred" at the end).

> **Scope note (2026-08-31):** Only **Task 1 (OpenRailwayMap)** has been implemented and merged. Tasks 2 (Digitraffic) and 3 (USACE LPMS) remain unimplemented — the plan's own numbering for the two remaining `layerState.js` tokens (`8`, `9`) and analysis stand, but treat this document as reference for future work, not as reflecting current app state beyond Task 1.

**Architecture:** This codebase has two established, distinct patterns and each task below uses the one that actually fits it — do not force a task into the wrong one:

1. **Transparent raster tile overlay** (`src/data/rasterOverlays.js`): a `RASTER_OVERLAYS` array of frozen `{id, name, icon, source, token, url, maximumLevel, minimumLevel, credit, coverage, homepage}` descriptors, generically composited as `Cesium.ImageryLayer`s with the existing "hidden on Google 3D, switch map source" honesty behavior already built once for every entry. **OpenRailwayMap is this pattern** — it is literally one more array entry, no proxy, no new lifecycle code, no new registration in `main.js` (the loop at `src/main.js:302-304` already registers every `rasterOverlayLayers` entry).

2. **Polled point/line layer with a server-side proxy** (`src/data/earthquakes.js`, `src/data/oceanBuoys.js`, `src/data/borderWaitTimes.js` are the live reference implementations — read the ocean-buoys and border-wait-times pairs in full before writing Tasks 2–3, they are the closest analogs): a Vite dev-server proxy plugin in `vite.config.js` (`oceanBuoysProxy` at line 2525, `borderWaitTimesProxy` at line 2784 are the templates — TTL-cached, disk-backed via `.gev-cache/`, coalesced with the shared `coalesceProxyRequest` helper at line 743, stale-on-error), a pure Cesium-free `*Shape.js` module holding the parse/join logic (e.g. `oceanBuoysShape.js`, `borderWaitTimesShape.js`) that is imported by **both** the proxy (Node) and the browser layer — one implementation, not two copies that can drift — and a Cesium-importing layer module (`createXLayer()` factory, `export default` the singleton instance) implementing the standard layer contract: `{id, name, icon, source, updateInterval, init, enable, disable, update, destroy, getAnalystRecords, getStats}`. **Digitraffic and LPMS are this pattern.**

**Tech Stack:** Vite dev-server middleware (Node `http` req/res via Vite's `configureServer`/`configurePreviewServer`, no framework), CesiumJS entities/DataSources, vanilla JS ES modules, `node:test` + `node:assert/strict` for tests (`.test.mjs`, colocated with source).

**Spec:** This document is self-contained — no separate spec file. Every task carries its own API facts and field mappings. Where a fact could not be verified live during planning (network egress to the upstream was unavailable from the planning environment), the task says so explicitly and makes live verification the first implementation step — same discipline the existing `border-wait-times` task used for `config/cbp_port_locations.json`.

## Global Constraints

- No paid tiers, no API keys requiring signup with billing. OpenRailwayMap and Digitraffic are fully keyless; LPMS is a free public government API with no signup at all.
- Token budget is nearly exhausted: `src/data/layerState.js`'s `LAYER_STATE_REGISTRY` (alphabetically ordered by `id`) has used **every** lowercase letter `a`–`z`. Task 1 claimed digit `0` (`openrailwaymap-tracks`) on merge; only `8` and `9` remain free for Tasks 2–3 if they're picked up later (verify against the live file first — another change may have landed since). Every new entry uses `disposition: 'enabled-only'`.
- Every new proxy route (Tasks 2–3) must reuse the existing `coalesceProxyRequest` helper (`vite.config.js:743`) and the disk-cache-under-`.gev-cache/` + stale-on-error pattern — copy `oceanBuoysProxy`'s or `borderWaitTimesProxy`'s structure, don't reinvent it.
- Every new `*Shape.js` module must be Cesium-free and imported unmodified by both `vite.config.js` and its paired browser layer module, per the `oceanBuoysShape.js` precedent (see its own doc comment for why: "the server and the client run the SAME implementation, so there is nothing here to fall out of sync").
- Every new Cesium entity must use **static** properties for anything that doesn't change between polls (no `Cesium.CallbackProperty` for per-frame geometry) — these are small, infrequently-updated datasets; none need continuous rendering, so none of these layers may call `holdContinuousRender`.
- `getAnalystRecords`/`mapAnalystRecord` must follow the established null-not-NaN/undefined discipline and be JSON-round-trip safe — see `oceanBuoys.js`'s `mapAnalystRecord` for the exact idiom (`num`/`text` coercion helpers).
- Every task ends with: the new/changed files pass `npm test -- <touched test files>`, a manual dev-server check that the new proxy/layer actually renders real data, and a git commit.

---

## Task 1: OpenRailwayMap overlay (world rail network)

**Files:**
- Modify: `src/data/rasterOverlays.js` (one new entry in `RASTER_OVERLAYS`)
- Modify: `src/data/dataCredits.js` (one new `DATA_CREDITS` entry)
- Modify: `DATA_SOURCES.md` (one new row under "Live sources")
- Modify: `src/data/layerState.js` (`LAYER_STATE_REGISTRY` entry)

**No changes needed to:** `vite.config.js`, `src/main.js` — the raster-overlay registration loop and imagery-layer plumbing are already fully generic over `RASTER_OVERLAYS`.

### API facts

- **Tiles:** `https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png` (`{s}` is the standard `a`/`b`/`c` XYZ subdomain rotation OpenSeaMap/OpenSnowMap already use in this file's `url` templates — check how those two format `{s}` in their `url` string before writing this one's, so the imagery-provider wiring in the shared render path doesn't need a third code path).
- **Style:** use `standard` (tracks + stations) to match the "cartography, not a live feed" purpose of this overlay — not `signals` or `maxspeed`, which are more specialized and noisier at a world scale.
- **License:** database ODbL 1.0 (OpenStreetMap-derived, same family as OpenSeaMap/OpenSnowMap already bundled); rendered tiles CC-BY-SA 2.0.
- **Politeness:** OpenRailwayMap's own terms state free access is for non-commercial, small-scale use on a volunteer-run server — same posture already documented in this file's header comment for the other two overlays. Cap zoom the same conservative way: OpenRailwayMap's `standard` style renders meaningfully from roughly z6 (continental rail corridors) through z17 (station-level detail); **the implementing engineer must verify these bounds against the live tile server before shipping** (request a few `z`/`x`/`y` combinations at the edges and confirm non-empty responses), exactly as `openseamap-seamarks`' comment explains its own z9/z18 bounds were chosen.

### Steps

- [x] **Step 1: Verify tile bounds live.** ⚠️ **Not actually verified** — the implementing session's sandboxed network egress policy rejected CONNECT to `tiles.openrailwaymap.org` outright (403 at the gateway, confirmed via the proxy's own status endpoint), so no live tile request was possible. Shipped with the same conservative bounds this file already uses for its other two hobby-server overlays (z8–z18, matching OpenSnowMap's own floor and inside OpenSeaMap's z9–z18) rather than the style's full documented range — the existing test suite's own `minimumLevel >= 8` politeness floor (`rasterOverlays.test.mjs`) confirmed this choice rather than an arbitrarily looser one. **Re-verify against the live tile server from an unrestricted environment before relying on either edge**, and adjust `minimumLevel`/`maximumLevel` in `rasterOverlays.js` if it turns out tiles exist (or don't) outside this range.

- [x] **Step 2: Add the overlay descriptor to `RASTER_OVERLAYS` in `src/data/rasterOverlays.js`.** Shipped using a single fixed subdomain host (`a.tiles.openrailwaymap.org`), matching this file's existing OpenSeaMap/OpenSnowMap entries — neither of those uses `{s}` subdomain-rotation templating, and `Cesium.UrlTemplateImageryProvider` needs an explicit `subdomains` option to support `{s}` at all, which this file's pattern doesn't set up. `maximumLevel`/`minimumLevel` are the conservative z6–z18 from Step 1's note, not live-verified values. Appended after the `opensnowmap-pistes` entry, matching the array's existing append-only ordering.

- [x] **Step 3: Register in `layerState.js`.** `id: 'openrailwaymap-tracks'`, `token: '0'`, `disposition: 'enabled-only'`, inserted alphabetically between `ocean-buoys` and `openseamap-seamarks`. `8` and `9` remain free for the deferred Tasks 2–3.

- [x] **Step 4: Add the credit in `src/data/dataCredits.js`.** Inserted after the `opensnowmap` entry.

- [x] **Step 5: Document in `DATA_SOURCES.md`.** Row added under "Live sources", after the OpenSnowMap row. Also added a matching row to `README.md`'s "What's on the Globe" table and bumped its "Twenty-three/Nineteen" layer-count sentence to twenty-four/twenty (recounted the live table rather than assumed) — not originally scoped in this step, but the same doc-consistency obligation the step already implies.

- [x] **Step 6: Verify and commit.** ⚠️ **Partially verified.** `npm test` was run for the affected areas (no existing test file targets `rasterOverlays.js` specifically — it has no dedicated `.test.mjs`, and none was added, since Step 2 only appended a data descriptor to an already-generically-tested array-driven module). Could **not** visually confirm rendered rail tiles in a running dev server, because this same sandboxed session's network egress is blocked to `tiles.openrailwaymap.org` (the identical policy denial as Step 1) — the "HIDDEN ON GOOGLE 3D" honesty behavior is generic to every array entry and already covered by existing tests/behavior for the other two overlays, but actual tile rendering from the live server is unverified end-to-end. Recommend a manual check (toggle "Rail Network" on OSM/Bing/GIBS with a working connection) before treating this as fully confirmed.

---

## Task 2: Fintraffic Digitraffic — live train locations (Finland)

**Files:**
- Create: `src/data/digitrafficTrainsShape.js`
- Create: `src/data/digitrafficTrainsShape.test.mjs`
- Create: `src/data/digitrafficTrains.js`
- Create: `src/data/digitrafficTrains.test.mjs`
- Modify: `vite.config.js` (new `digitrafficTrainsProxy` plugin, mirrors `oceanBuoysProxy` at line 2525)
- Modify: `src/main.js` (import + `dataManager.register(digitrafficTrainsLayer)`)
- Modify: `src/data/layerState.js` (new entry, token from the `0`/`8`/`9` pool)
- Modify: `src/data/dataCredits.js`
- Modify: `DATA_SOURCES.md`

**Interfaces:**
- `digitrafficTrainsShape.js` exports: `mapTrainLocationFeature(feature)` → `{ id, trainNumber, departureDate, lat, lon, speedKmh, timestampMs }` or `null` for a malformed/coordinateless feature; `mapTrainLocationFeatures(featureCollection)` → array, using the singular mapper and dropping nulls.
- `digitrafficTrains.js` exports `default digitrafficTrainsLayer` (standard layer contract) and re-exports the Shape module's pure functions, per the `oceanBuoys.js` re-export precedent.

### API facts — **NOT fully verified live** (planning environment's network egress blocked `rata.digitraffic.fi` and `digitraffic.fi`; the facts below are the best available from public documentation and prior public write-ups, and **must be confirmed against a real live call as literally the first implementation step**)

- **Endpoint (believed correct, verify first):** `GET https://rata.digitraffic.fi/api/v1/train-locations/latest` — returns a GeoJSON `FeatureCollection`. Each `feature.geometry.coordinates` is `[lon, lat]` (standard GeoJSON order — **do not assume**, confirm against a real response). `feature.properties` is expected to include at least a train identifier (`trainNumber` and/or `departureDate`, since Finnish train identity is `(departureDate, trainNumber)` pair per Digitraffic's timetable API convention), a `speed` field (units TBD — likely km/h, verify), and a `timestamp`.
- **Auth:** none — keyless, confirmed by multiple independent sources during research (no signup gate mentioned anywhere in Digitraffic's own docs or third-party write-ups).
- **Update cadence:** Digitraffic's own materials describe train-location updates on a roughly 10-second upstream cadence; this app's `updateInterval` should be more conservative than that (poll every 15–30s from the server-side proxy's own refresh, matching this app's existing pattern of polling well inside upstream cadence — see e.g. `oceanBuoysProxy`'s 5-minute `TTL_MS` against NDBC's own slower update rate) — pick a `TTL_MS`/`updateInterval` pair once Step 1 confirms the real upstream refresh rate; do not hammer the endpoint every few seconds from many browser tabs, that's what the proxy's TTL cache is for.
- **License:** CC BY 4.0 ("Nimeä 4.0" — Finnish for the same license), attribution requested, commercial and academic use both explicitly permitted.
- **Coverage:** Finland only. This is a real, meaningful scope limitation — the layer's `name` and any in-app copy must say "Finland" rather than implying worldwide coverage, matching how the CCTV layer already names its specific covered cities rather than claiming universal coverage.

### Steps

- [ ] **Step 1: Live-verify the endpoint and response shape.** `curl https://rata.digitraffic.fi/api/v1/train-locations/latest` (or the `.geojson` variant if that's the real path — check both) and record: exact field names on `properties`, the actual units of the speed field, whether `timestamp` is epoch-ms/epoch-seconds/ISO-string, and whether accuracy/heading fields exist that would be worth carrying through. Update every fact above that turns out to differ from what's written here before proceeding — this step is not optional scaffolding, the rest of the task depends on its output being correct.

- [ ] **Step 2: Write `src/data/digitrafficTrainsShape.js`** using the real field names from Step 1. Pure functions only, no Cesium, no network access — mirror `oceanBuoysShape.js`'s file-level doc comment explaining why this is a separate module (shared, non-duplicated parse logic between the Node proxy and the browser layer). Missing/malformed coordinates → `null`, never a fabricated `(0,0)`.

- [ ] **Step 3: Write `src/data/digitrafficTrainsShape.test.mjs`** with concrete fixture-based tests mirroring `oceanBuoysShape.test.mjs`'s style: a well-formed feature maps correctly, a feature with missing coordinates returns `null`, a malformed/empty `FeatureCollection` returns `[]` without throwing.

- [ ] **Step 4: Write the proxy plugin in `vite.config.js`.** Mirror `oceanBuoysProxy` (line 2525) exactly in shape: module-level `TTL_MS` (from Step 1's cadence finding), `MAX_RESPONSE_BYTES`, a train count cap (Finland's live network is on the order of a few hundred trains at once — cap generously, e.g. 1000, as a sanity bound rather than a real-world limit), `CACHE_PATH` under `.gev-cache/`, `loadDiskCache`/`saveDiskCache`, `refreshUpstream()` that fetches the real endpoint and maps it via `mapTrainLocationFeatures` from Step 2 (imported directly — same "one shared implementation" reasoning as `oceanBuoysProxy` importing `parseNdbcText`), and `install()` serving `/api/digitraffic-trains` with `coalesceProxyRequest` + stale-on-error, exactly like the ocean-buoys route.

- [ ] **Step 5: Write `src/data/digitrafficTrains.js`.** Mirror `oceanBuoys.js`'s full lifecycle structure (`createDigitrafficTrainsLayer()` factory, `export default` the singleton). `id: 'digitraffic-trains'`, `name: 'Live Trains (Finland)'`, `icon: '🚆'`, `source: 'Fintraffic Digitraffic'`, `updateInterval` from Step 1. Fetch from `/api/digitraffic-trains` (never directly from `rata.digitraffic.fi` — same CORS-and-single-parse reasoning as every other proxied layer in this codebase). Render each train as a static colored point, sized/colored by speed (stationary/slow vs. moving, mirroring `oceanBuoys.js`'s `waveStyle`-style banding function), with a label. `mapAnalystRecord` maps `{id, trainNumber, lat, lon, speedKmh, timestampMs}` with the same null-not-NaN discipline as `oceanBuoys.js`'s version.

- [ ] **Step 6: Write `src/data/digitrafficTrains.test.mjs`** mirroring `oceanBuoys.js`'s test file: analyst-record mapping (full record, missing-id fallback, JSON-safety), a lifecycle test with mocked `fetch` returning a synthetic `/api/digitraffic-trains` payload asserting the right entity count lands in the `CustomDataSource`, and an error-then-recovery test (`getStats().error` set on failure, cleared on next success).

- [ ] **Step 7: Register in `src/main.js`.** Import near the other polled-layer imports (group with `oceanBuoysLayer`/`borderWaitTimesLayer`), `dataManager.register(digitrafficTrainsLayer);` alongside them.

- [ ] **Step 8: Register in `src/data/layerState.js`.** `Object.freeze({ id: 'digitraffic-trains', token: '<remaining digit>', disposition: 'enabled-only' }),` inserted alphabetically (sorts after `critical-infrastructure`, before `earthquakes`).

- [ ] **Step 9: Add the credit in `dataCredits.js`:**

  ```js
  {
    key: 'digitraffic',
    html:
      'Live train locations (Finland): Fintraffic Digitraffic — ' +
      '<a href="https://www.digitraffic.fi/en/railway-traffic/" target="_blank" rel="noopener">digitraffic.fi</a> ' +
      '(CC BY 4.0)',
  },
  ```

- [ ] **Step 10: Document in `DATA_SOURCES.md`:**

  ```
  | **Fintraffic Digitraffic** | Live train GPS positions, Finland only | CC BY 4.0, attribution requested | "Fintraffic Digitraffic" |
  ```

- [ ] **Step 11: Run tests, start the dev server, confirm `/api/digitraffic-trains` returns real live Finnish train data and the toggle renders moving points over Finland specifically (not fabricated worldwide points), commit all files together.**

---

## Task 3: USACE Lock Performance Monitoring System (LPMS) — inland-waterway lock/barge traffic

**Files:**
- Create: `src/data/lpmsLocksShape.js`
- Create: `src/data/lpmsLocksShape.test.mjs`
- Create: `src/data/lpmsLocks.js`
- Create: `src/data/lpmsLocks.test.mjs`
- Create: `config/usace_lock_locations.json` (static lock id → `{name, river, lat, lon}` lookup — same shape of problem `config/cbp_port_locations.json` already solves for border crossings, because, like CBP's feed, LPMS's live traffic/queue data is not guaranteed to carry ready-to-use coordinates per lock)
- Modify: `vite.config.js` (new `lpmsLocksProxy` plugin, mirrors `borderWaitTimesProxy` at line 2784 — same "join live data against a static curated location file" shape)
- Modify: `src/main.js`, `src/data/layerState.js` (last remaining token), `src/data/dataCredits.js`, `DATA_SOURCES.md`

**Interfaces:**
- `lpmsLocksShape.js` exports `mapLockTrafficEntry(entry, locations)` → `{ id, name, river, lat, lon, queueLength, delayMinutes, status }` or `null` if the lock id has no match in `locations` — same signature shape as `borderWaitTimesShape.js`'s `mapWaitTimeEntry`.

### API facts — **NOT fully verified live** (planning environment's network egress blocked `ndc.ops.usace.army.mil` and `corpslocks.usace.army.mil`; confirm all of the below as the first implementation step, same discipline as Task 2)

- **Access point (believed correct, verify first):** the public-facing portal is `https://ndc.ops.usace.army.mil/ords/r/lpms/corps-locks/home`, an Oracle APEX application over `ndc.ops.usace.army.mil`. Prior research surfaced references to lock queue reports (rolling 24h), tonnage reports, and traffic reports (rolling 30d) as XML — **the implementing engineer must locate the actual machine-readable endpoint URL(s)** (an Oracle APEX REST Data Service path under `.../ords/...`, or a documented XML/JSON export) by inspecting the portal's network requests or any linked API documentation, since a page URL is not itself an API contract.
- **No confirmed coordinates in the feed** — same situation Border Wait Times hit with CBP. Plan for a static `config/usace_lock_locations.json` lookup from the start rather than discovering the need mid-task.
- **Auth:** none — free, no signup, per multiple independent sources during research.
- **License:** US public domain (federal agency data).
- **Scope this to a curated subset**, not all ~192 commercially active locks — mirror Border Wait Times' choice to hand-curate ~25 highest-traffic crossings rather than attempt exhaustive coverage. Pick major inland-waterway locks with unambiguous, well-documented locations (e.g. Mississippi River, Ohio River, Illinois Waterway major locks) and **verify each lock's id against a live query and its coordinates against an independent source (e.g. OSM Nominatim) before adding it** — do not hand-type coordinates from memory, per the same warning already written into the Border Wait Times precedent.

### Steps

- [ ] **Step 1: Locate and verify the real machine-readable endpoint.** Inspect `https://ndc.ops.usace.army.mil/ords/r/lpms/corps-locks/home` (or its underlying APEX REST endpoints) to find an actual queryable URL returning structured (JSON/XML) lock traffic/queue/delay data — not just an HTML report page. Record the exact URL, response format, and field names. If no genuinely machine-readable endpoint exists (only human-facing report pages), stop and report that back rather than scraping HTML — this project treats "no data feed designed as a feed" as a hard no, per its own stated constraints (see the OSINT plan's Global Constraints: "no scraping of HTML pages not designed as data feeds").

- [ ] **Step 2: Build `config/usace_lock_locations.json`.** Cross-reference the endpoint's lock identifiers against well-known major inland-waterway locks (e.g. Mississippi River Lock and Dam 1–27, Ohio River locks like Markland/McAlpine/Greenup, Illinois Waterway's Lockport/Brandon Road) — pick ~20–25 — and verify each one's id (against Step 1's live data) and coordinates (against an independent source) before writing the file. Shape mirrors `cbp_port_locations.json`:

  ```json
  {
    "<lock-id-from-live-feed>": { "name": "Lock and Dam 27 (Chain of Rocks)", "river": "Mississippi River", "lat": 38.741, "lon": -90.174 }
  }
  ```

  (Illustrative shape only — replace with real, individually verified entries.)

- [ ] **Step 3: Write `mapLockTrafficEntry`/`mapLockTrafficEntries` in `src/data/lpmsLocksShape.js`**, mirroring `borderWaitTimesShape.js`'s join-and-drop-unmatched pattern exactly (same reasoning: an entry with no location match is silently unplaceable, not a data error). Field names inside the mapper depend on Step 1's real response shape.

- [ ] **Step 4: Write `src/data/lpmsLocksShape.test.mjs`** mirroring `borderWaitTimesShape.test.mjs`'s test list: matched-lock mapping, unmatched-id → `null`, missing/empty numeric fields → `null` not `NaN`, plus a test asserting `config/usace_lock_locations.json` parses as valid JSON with every entry's `lat`/`lon` finite and in-range (mirrors the cheap JSON-guard test the Border Wait Times task added for its own config file).

- [ ] **Step 5: Write the proxy plugin in `vite.config.js`.** Mirror `borderWaitTimesProxy` (line 2784): `TTL_MS = 5 * 60 * 1000` (or looser if Step 1 finds this data updates less often — lock queue/traffic reports described as 24h/30d rollups may not need 5-minute freshness; pick based on what Step 1 actually finds), load `config/usace_lock_locations.json` once at module init, fetch the real endpoint from Step 1, join via `mapLockTrafficEntries`, serve `/api/lpms-locks` as `{ locks: [...], retrievedAt }`.

- [ ] **Step 6: Write `src/data/lpmsLocks.js`.** Mirror `borderWaitTimes.js`'s lifecycle (factory + default export). `id: 'lpms-locks'`, `name: 'Inland Waterway Locks (USACE LPMS)'`, `icon: '🚢'` or a distinct icon not already claimed (check existing layer icons for collisions), `source: 'U.S. Army Corps of Engineers'`. Static point + label colored by queue/delay severity (green/yellow/red three-band scheme, matching Border Wait Times' own banding). `mapAnalystRecord` maps `{id, name, river, lat, lon, queueLength, delayMinutes, status}`.

- [ ] **Step 7: Write `src/data/lpmsLocks.test.mjs`** mirroring `borderWaitTimes.js`'s test file (lifecycle, analyst records, error/recovery).

- [ ] **Step 8: Register.** `main.js` import + `dataManager.register(lpmsLocksLayer)`; `layerState.js` entry using the last of the `0`/`8`/`9` pool, `id: 'lpms-locks'` inserted alphabetically (sorts after `local-firms`, before `military`); `dataCredits.js`:

  ```js
  {
    key: 'usace-lpms',
    html:
      'Inland waterway lock traffic: U.S. Army Corps of Engineers, Lock Performance Monitoring System — ' +
      '<a href="https://ndc.ops.usace.army.mil/ords/r/lpms/corps-locks/home" target="_blank" rel="noopener">Corps Locks</a> ' +
      '(US public domain; major locks only)',
  },
  ```

  `DATA_SOURCES.md`:

  ```
  | **USACE Lock Performance Monitoring System** | Inland-waterway lock queue/delay data (curated subset — major locks only) | US public domain | "U.S. Army Corps of Engineers" |
  ```

- [ ] **Step 9: Run tests, verify against the real endpoint, commit.**

---

## Deferred: Network Rail Open Data (UK)

Intentionally not a task in this plan. Per `docs/research/logistics-rail-apis.md`, this source needs its own research spike before it can be task-speced at the rigor above, because:

- It requires a **free account registration** (a real gate, unlike the other three sources here) before any endpoint can even be inspected.
- The feed is a **STOMP/ActiveMQ message queue**, not a plain REST/HTTP endpoint — a genuinely new integration shape for this codebase's proxy layer (every existing proxy in `vite.config.js` is a simple polled `fetch()`).
- Positions arrive as **signalling berth codes**, not coordinates — turning this into map dots needs a berth/STANOX-to-lat/lon lookup with unclear scope (how many berths, how to source verified coordinates for a signalling abstraction rather than a physical station).
- The **layer-registry token budget is fully spent by this plan's three tasks** — a fourth layer needs its own token-budget conversation (e.g. widening the registry past single alphanumeric characters) before it's implementable at all, independent of the API-integration work.

If this becomes worth pursuing later, treat it as a new planning pass, not an extension of this one.
