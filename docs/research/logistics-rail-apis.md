# Research: Free Rail / Locomotive & Logistics APIs

**Date:** 2026-08-30
**Status:** Research only — nothing in this doc is implemented yet.
**Ask:** find free rail ("locomotive"), freight, and other logistics data sources God's Eye View could add, in the spirit of the existing flights/vessels/traffic layers.

## TL;DR

Rail and freight don't have a single global, keyless, real-time feed the way ADS-B (flights) and AIS (ships) do — rail position data is fragmented per national operator, and truck/freight-shipment tracking is almost entirely paid/commercial (carrier-gated). But three genuinely free sources are worth adding, in order of effort:

| # | Source | What it adds | Cost/auth | Effort |
|---|--------|--------------|-----------|--------|
| 1 | **OpenRailwayMap** | World rail network as a map overlay (tracks, stations, electrification, gauge) | 🟢 free, keyless, ODbL | **Trivial** — same pattern as the existing OpenSeaMap/OpenSnowMap overlays |
| 2 | **Fintraffic Digitraffic (Finland)** | Real GPS positions of every live train in Finland, updated ~10s | 🟢 free, keyless | **Medium** — new layer, one country's coverage |
| 3 | **Network Rail Open Data (UK)** | Real train movements (incl. freight) across the whole GB network | 🟡 free registration required | **High** — feed is berth/schedule-based, not raw GPS; needs a static station/berth→coordinate lookup, same pattern this repo already used for CBP border crossings |

A fourth, non-map source is worth flagging for later: **USACE Lock Performance Monitoring System (LPMS)** — free, keyless, real US inland-waterway lock traffic/delay data (barge freight), same shape as the border-wait-times layer.

Everything else found (Amtrak, most freight-rail carriers, container/rail tracking APIs like Terminal49/Vizion/Portcast/FreightPulse, BNSF's own API) is either unofficial-scraper-only, business-partner-gated, or a paid product — see "Ruled out" below.

---

## 1. OpenRailwayMap — world rail network overlay

**What it is:** An OSM-derived project rendering railway infrastructure (tracks, stations, signals, electrification, gauge, speed limits) as XYZ tiles, worldwide, historical data included via OpenHistoricalMap.

- **Tiles:** `https://{s}.tiles.openrailwaymap.org/{style}/{z}/{x}/{y}.png` — styles include `standard` (tracks/stations), `signals`, `maxspeed`, `electrification`, `gauge`.
- **Auth:** none. Keyless.
- **License:** database ODbL 1.0 (same as OpenSeaMap/OpenSnowMap already bundled here); rendered tiles CC-BY-SA 2.0.
- **Cost/politeness:** free tier is explicitly for non-commercial, small-scale use — same "volunteer-run hobby tile server" posture this repo already codifies for OpenSeaMap/OpenSnowMap (capped zoom levels, no CDN behind it).

**Why it's the easy win:** `src/data/rasterOverlays.js` already implements exactly this shape of layer — a `RASTER_OVERLAYS` array of `{id, name, icon, source, token, url, maximumLevel, minimumLevel, credit, coverage, homepage}` descriptors, composited as `Cesium.ImageryLayer`s, with the "hidden on Google 3D, switch map source" honesty message already built generically for every entry in the array. Adding OpenRailwayMap as a third overlay is adding one more frozen object to that array plus a `DATA_SOURCES.md` row and a `dataCredits.js` entry — no new proxy, no new lifecycle code, no new tests beyond what the array already covers generically.

Only wrinkle: token budget. `layerState.js`'s `LAYER_STATE_REGISTRY` has used all 26 lowercase letters; only digits `0`, `8`, `9` remain free. This layer would claim one of them.

---

## 2. Fintraffic Digitraffic — live Finnish train GPS (the real "locomotive tracking" layer)

**What it is:** Finland's national transport agency (Fintraffic) publishes genuine live GPS positions for every train running in Finland — this is the actual ADS-B/AIS-equivalent for rail, just scoped to one country instead of the world.

- **Endpoint:** `GET https://rata.digitraffic.fi/api/v1/train-locations/latest` (GeoJSON: `.../train-locations.geojson/latest`) — returns latest WGS84 coordinates, speed, heading, per train.
- **Also available:** GTFS-RT feeds (`/api/v1/trains/gtfs-rt-locations`, `/gtfs-rt-updates`), full timetable/dispatch data, and — notably — Digitraffic separately publishes free **marine (AIS)** and **road-traffic** APIs for Finland too, under the same program.
- **Auth:** none. Fully keyless.
- **Update cadence:** ~every 10 seconds.
- **License:** CC BY 4.0 (Nimeä 4.0), machine-readable open data, citation requested.

**Fit:** This is a live moving-point layer, closest analog to `earthquakes.js`/`oceanBuoys.js`'s lifecycle contract already used repeatedly in this codebase (proxy → `updateInterval` poll → `CustomDataSource` of static per-frame points → `getAnalystRecords`/`getStats`). Coverage is Finland-only, which is an honest limitation to label in the UI exactly the way CCTV already labels its city-by-city coverage (Austin/California/London) rather than implying worldwide trains.

---

## 3. Network Rail Open Data — GB train movements including freight

**What it is:** Network Rail's open-data platform (`publicdatafeeds.networkrail.co.uk`) publishes real-time train movement data for the entire Great Britain rail network, passenger **and freight**.

- **TRUST (Train Movements) feed:** reports actual/predicted arrival/departure/pass events per train, with delay reasons.
- **TD (Train Describer) feed:** signalling-berth-level "where is this train right now" — but berths are named signalling sections, not lat/lon.
- **Auth:** 🟡 free registration required at `publicdatafeeds.networkrail.co.uk/ntrod/welcome` (light gate, same tier as AISStream/FIRMS/TomTom already in this project — free account, no billing).
- **License:** Network Rail's own open-data licence; no uptime guarantee stated.

**Why it's harder than Digitraffic:** there's no raw GPS field — positions are expressed as berth codes / STANOX/TIPLOC station codes, so turning this into map dots requires a static berth-or-station → lat/lon lookup, the same shape of problem this repo already solved for `config/cbp_port_locations.json` (CBP border crossings have no coordinates either). That's a known, bounded pattern here, just more upfront curation work than Digitraffic's "coordinates are already in the payload" case. Also a message-queue (STOMP/ActiveMQ) feed rather than plain REST, which is a new integration shape for this codebase's proxy layer.

**Payoff:** would be the first freight-specific rail layer (TRUST movement records distinguish freight headcodes), across a whole national network rather than one country's Finland-scale slice.

---

## 4. USACE Lock Performance Monitoring System (LPMS) — inland-waterway freight (barges)

Not a moving-asset tracker, but genuinely free logistics data adjacent to the existing vessel/border layers:

- **Endpoint:** `corpslocks.usace.army.mil` / `ndc.ops.usace.army.mil` — lock queue reports (rolling 24h), tonnage reports, traffic reports (rolling 30d) across ~192 commercially active US inland-waterway locks.
- **Auth:** none, free tier, no email required.
- **License:** US public domain (federal government data).

**Fit:** same shape as the existing Border Wait Times layer — static lock locations (locks don't move) joined with live queue/delay data, colored by wait severity. Lower visual excitement than a moving-dot layer, but real freight-logistics signal (barge traffic is a meaningful chunk of US inland freight) with zero licensing friction.

---

## Ruled out (checked, not viable as free/keyless)

- **Amtrak** — no official public API; only unofficial reverse-engineered scrapers exist (fragile, ToS-risk, not "free API" in the sense this project's other sources are).
- **Truck-level live tracking** (individual trucks/ELD positions) — this is fleet-owner-private data by design (privacy + competitive reasons); no public equivalent to ADS-B/AIS exists for road freight. FMCSA's public APIs (SAFER) expose carrier *registry/safety* records, not live vehicle positions.
- **Container/rail freight tracking APIs** (Terminal49, Vizion, Portcast, Gnosis Freight, FreightPulse) — commercial products; even the ones with a "free" tier (e.g. Terminal49's free key for up to 100 containers) require signing up as their customer and are scoped to your own shipments, not a public global feed anyone can poll anonymously.
- **BNSF API** — exists, but is a customer/shipper-facing API for tracing your own freight, not a public feed of network-wide train positions.
- **Port congestion indices** (MarineTraffic, project44, FreightPulse) — paid commercial products; the closest free equivalent is BTS's aggregate, non-real-time freight indicator datasets (statistics, not a live map layer).
- **"TrainsTracking"/"TrainTrackings"-style aggregator sites** surfaced in search results — these read as marketing/scraper front-ends rather than documented official APIs; no verifiable terms or stable endpoint found. Not recommended without a lot more due diligence than the sources above needed.

---

## Recommendation

If/when this moves from research to implementation, do it in this order:
1. **OpenRailwayMap** as a third `rasterOverlays.js` entry — near-zero engineering risk, immediately visible value (world rail network context under the existing sea-marks/ski-pistes overlay pattern).
2. **Fintraffic Digitraffic live trains** as a new polled layer — the one source here that's an honest "locomotive tracking" experience matching the flights/vessels bar, scoped and labeled to Finland.
3. **Network Rail Open Data (UK)** and/or **USACE LPMS** as follow-ups once the above land, each needing its own registration/curation work as detailed above.

Token budget note: only `0`, `8`, `9` remain free in `LAYER_STATE_REGISTRY` — plan which of these (if more than three) actually ship before claiming tokens.
