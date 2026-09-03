# Geolocating Geopolitical & Noteworthy Events — Research

Research pass on widening God's Eye View's coverage of *geopolitical and
noteworthy events* — conflict, unrest, terrorism, humanitarian crises,
maritime incidents — beyond what's already wired. Companion to
[`DATA_SOURCES.md`](../DATA_SOURCES.md); this doc is analysis and a proposal,
not yet an attribution ledger. Nothing here is implemented until it lands in
`DATA_SOURCES.md` + `src/data/dataCredits.js` per the normal pattern.

## 1. What's already wired

Two GDELT integrations exist today, and the app is already opinionated about
the core problem this research is about — see `src/data/gdeltEvents.js`:

- **`gdelt-events` layer ("Global Reporting")** — `/api/gdelt/geo` (proxy in
  `vite.config.js`) queries GDELT's **GEO 2.0** API for three preset themes
  (`unrest`, `conflict`, `disaster`; `src/data/gdeltEventsShape.js`). It plots
  **places mentioned in news coverage**, sized by mention count.
- **Cockpit regional headlines** — `/api/regional-brief` uses **GDELT DOC
  2.0** as a fallback to Google News RSS for locality-matched article
  headlines near the aircraft/camera (`src/data/regionalBrief.js`).

The load-bearing design decision, stated directly in `gdeltEvents.js`'s
module doc: **a dot is a place that was mentioned, not a confirmed
incident**, and the UI never says "events" where it means "mentions." Ten
dots can be ten articles about one thing; an empty region means nobody in
GDELT's monitored sources wrote about it, not that nothing happened. Any new
source added under this initiative has to keep that same honesty — it's the
one thing every candidate below gets scored against.

The query surface is also a closed preset allowlist by design (see the
`gdeltEventsShape.js` header) — the client never sends free text to GDELT,
so there's no path to build named-person search by accident. Any new source
should keep that same shape: fixed, event-typed presets, not open text
search.

## 2. The core distinction: mention geocoding vs. event geocoding

Two structurally different things both get called "geolocating news events,"
and conflating them is the actual risk in this initiative:

1. **Mention geocoding** (what GDELT GEO 2.0 already gives us): geocode
   every place-name mentioned in matching articles. High recall, high noise,
   no claim about ground truth. Good for "where is the world's attention
   right now."
2. **Event geocoding** (curated conflict/crisis datasets): a human- or
   ML-vetted record that something specific happened at a specific point —
   an armed clash, a protest, a strike on infrastructure — with a
   date, actor(s), event type, and a coordinate carrying an explicit
   precision/confidence flag. Lower recall (only what got coded), much
   higher confidence per dot.

The app currently only has (1). The gap this research addresses is (2).

## 3. Candidate sources

### 3.1 Structured conflict & political-violence event data

| Source | Coverage | Geocoding | Update cadence | License | Fit |
|---|---|---|---|---|---|
| **GDELT Event Database 2.0** | Global, ~65 languages, CAMEO-coded (300+ event types: protest, violence, diplomatic, material conflict, appeals, etc.) | Per-record `Actor1Geo`/`Actor2Geo`/`ActionGeo` lat/lon, landmark-centroid precision, resolution type flagged (country/ADM1/city/landmark) | 15 min | Free, unrestricted incl. commercial; citation requested | **Already integrated at the network level** (same `api.gdeltproject.org` host, same proxy pattern as GEO 2.0) — the natural first move |
| **ACLED** (Armed Conflict Location & Event Data Project) | Global, human-coded political violence & protest, event types: battles, violence against civilians, explosions/remote violence, riots, protests, strategic developments | Locality-level (village/town/neighborhood) lat/lon with an explicit precision code (1–3) | Weekly | **Free for non-commercial** (registration required); commercial use needs a paid corporate license | Highest-confidence conflict layer available; NonCommercial-shaped exactly like the existing TeleGeography/GFW carve-outs |
| **UCDP** (Uppsala Conflict Data Program) — Candidate Events + GED | Global, organized-violence events (state-based, non-state, one-sided) | Fully geocoded, precision-flagged | Candidate Events: monthly (near-real-time feed); GED: annual (high-confidence, vetted) | Free; citation required; commercial redistribution restricted | Academically the gold standard; monthly cadence is slower than GDELT/ACLED but very low false-positive rate |
| **Global Terrorism Database (GTD)** | Historical terrorism incidents, 1970–2020 | Point-geocoded | **Frozen at 2020, access now gated behind a request form (2025 policy change)** | Restricted | **Not viable for a live layer** — stale and access-gated. Note only; don't build against it. |

### 3.2 Humanitarian, displacement & disaster context

Already strong on physical hazards (USGS earthquakes, GDACS, NASA EONET,
NIFC/WFIGS fire perimeters, NOAA NWS/NHC, FIRMS). What's missing is the
*humanitarian-response* layer — not "a flood happened" but "an appeal/response
is underway."

| Source | Adds | Geocoding | License |
|---|---|---|---|
| **ReliefWeb (UN OCHA)** | Disaster + crisis situation reports, response updates, appeals | Country/ADM1-level via UN Common Operational Datasets (P-codes); not point-precise | Free, no auth for basic queries |
| **IOM Displacement Tracking Matrix (DTM)** | Population displacement flows tied to conflict/disaster | Site/admin-level | Free, per-dataset terms |
| **UNHCR data portal** | Refugee/asylum population movements | Country/region | Free |

These complement, not duplicate, the existing GDACS/EONET/NIFC layers — they
answer "what is the humanitarian consequence," which those hazard feeds
don't carry.

### 3.3 Domain-specific incident feeds

| Source | Domain | Geocoding | Notes |
|---|---|---|---|
| **IMB Piracy Reporting Centre live map** | Maritime piracy/armed robbery | Per-incident coordinates (estimated when unconfirmed) | No documented public API — the map itself is the product; scraping would carry ToS risk. Complements existing Global Fishing Watch vessel-events layer (AIS gaps/encounters) rather than replacing it — GFW infers suspicious *behavior*, IMB records *reported attacks*. Worth a manual license check with ICC-CCS before any wiring, not a background-research green light. |
| **WHO Disease Outbreak News** | Public-health emergencies | Country-level only, RSS/HTML, no coordinates | Too coarse to geolocate below country; better suited to a text panel (like the space-weather panel) than a globe layer |
| **CFR Cyber Operations Tracker** | State-linked cyber incidents | Attributed country of origin/target, not a physical location of "the event" | Manually curated, no API — not viable for live wiring; noted for completeness since it's a common ask |
| **OpenSanctions** | Sanctioned entities/individuals | Entity-level, not event-level; no reliable coordinate | Answers a different question ("who is sanctioned") than "what happened where" — out of scope for a geolocation layer |

### 3.4 Explicitly out of scope

- **Named-entity / named-person news search.** The GDELT wiring already
  refuses this by construction (fixed preset table, no free text to the
  API). ACLED, UCDP, and GDELT Event 2.0 are all event-typed, not
  person-search, so they don't reopen that door — keep it that way for any
  future source too.
- **Social-media firehoses** (X/Twitter geotagged posts, Telegram scraping
  for OSINT-style geolocation). Real geolocation signal exists here, but
  ToS, cost, and — more importantly — the app's whole "cite an authoritative
  source, be honest about what a dot means" ethos don't fit unverified
  crowd-sourced posts. Bellingcat-style geolocation is a *methodology*, not
  a feed; nothing to wire.
- **Real-time military-movement inference beyond public ADS-B.** Already
  covered by the existing `militaryFlights`/`militaryAwareness` layers;
  going further (satellite-derived troop movement, etc.) is a different,
  much higher-stakes project.

## 4. What range of events this actually lets us discern

Combining what's live today with the strongest candidate (GDELT Event 2.0,
same host/proxy shape as the existing GEO 2.0 wiring) and the NonCommercial
add-on (ACLED/UCDP):

| Event class | Source | Precision | Latency | Confidence |
|---|---|---|---|---|
| Media attention hotspots (any topic) | GDELT GEO 2.0 *(live)* | Place-name centroid | ~15 min | Low — mentions, not incidents |
| Protests / civil unrest | GDELT Event 2.0 (CAMEO root 14) → ACLED (riots/protests) | Landmark → locality | 15 min → weekly | Medium → High |
| Armed conflict / battles | GDELT Event 2.0 (root 19–20) → ACLED/UCDP | Landmark → locality/GED-precise | 15 min → weekly/monthly | Medium → High |
| Terrorism / explosions, remote violence | GDELT Event 2.0 (root 18) → ACLED | Landmark → locality | 15 min → weekly | Medium → High (GTD not viable live) |
| Diplomatic events (visits, statements, sanctions, agreements) | GDELT Event 2.0 (roots 01–08) | Landmark/country | 15 min | Low–Medium |
| Natural disasters | GDACS, EONET, NIFC, USGS, NHC *(all live today)* | Point/perimeter | Minutes–hours | High (authoritative agencies) |
| Humanitarian response / displacement | ReliefWeb, IOM DTM, UNHCR | Country/ADM1 | Daily | High (but coarse) |
| Maritime piracy / armed robbery | IMB live map (unwired, license TBD) | Per-incident, sometimes estimated | Near-real-time | Medium |
| Vessel anomalies (loitering, AIS gaps, encounters) | Global Fishing Watch *(already wired, opt-in)* | Point | Periodic | Medium (behavioral inference) |
| Border friction | CBP wait times *(already wired, curated subset)* | Fixed crossing points | Periodic | High |
| Public-health emergencies | WHO DON | Country only | Days | High but not a globe dot |

The honest ceiling: nothing here gives *verified ground truth* at street
precision in real time — that's not a data-availability problem, it's what
open conflict/crisis data is. The realistic uplift is going from "one preset
GDELT mentions layer" to "mentions (breadth) + CAMEO-typed events (breadth +
some structure) + ACLED/UCDP (narrow but high-confidence political
violence)" — three tiers of the same honesty ladder the app already applies
to GDELT GEO today.

## 5. Recommended wiring, in the app's existing shape

Every existing live layer follows the same four-piece pattern (clearest
example: `gdeltEvents.js` / `gdeltEventsShape.js` / the `gdeltEventsProxy()`
plugin in `vite.config.js` / registration in `dataCredits.js` +
`layerState.js` + `main.js`). The recommendation is to reuse that pattern,
not invent a new one.

**Phase 1 — GDELT Event 2.0 as a new layer, not a GEO 2.0 replacement.**
Same upstream project, same proxy-cache-coalesce shape already proven in
`gdeltEventsProxy()`. Where GEO 2.0 answers "where is coverage," Event 2.0
adds CAMEO event *type* per record (protest vs. battle vs. diplomatic
statement) with its own actor/action geocoding — a genuinely different
signal, not a duplicate. Keep the same closed-preset-only query surface and
the same "mentions/records are reporting, not confirmed incidents" framing
in the status line, since Event 2.0 is still auto-extracted from news text,
not human-vetted.

**Phase 2 — ACLED as an optional BYOK layer**, mirroring the TomTom/GFW
pattern already in the codebase (`TOMTOM_API_KEY`, `GFW_API_TOKEN`): off by
default, requires the operator's own free ACLED registration, and ships with
the same kind of NonCommercial carve-out note already written for GFW in
`DATA_SOURCES.md` §"Global Fishing Watch is NonCommercial." This is the
layer that actually earns the word "event" instead of "mention" or "report."

**Phase 3 — ReliefWeb** as a text-panel source (like the space-weather
panel or cockpit regional briefing), not a globe-dot layer — its geocoding
is country/ADM1, too coarse for a point marker, but it's exactly the
"what's the humanitarian response" context the physical-hazard layers don't
carry.

**Not recommended right now:** UCDP (redundant with ACLED at a slower
cadence for a live app — better fit for a future "authoritative annual
baseline" toggle than a live layer), GTD (stale/access-gated), IMB piracy
(no API — needs a direct license conversation before any code), WHO DON,
CFR tracker, OpenSanctions, and anything social-media-sourced (see §3.4).

## 6. Sources consulted

- [GDELT Project — data.html](https://gdeltproject.org/data.html), [GDELT Event Codebook 2.0](http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf)
- [ACLED — API documentation](https://acleddata.com/acled-api-documentation), [Terms of Use & Attribution Policy](https://acleddata.com/terms-and-conditions), [myACLED FAQs](https://acleddata.com/myacled-faqs)
- [UCDP Candidate Events Dataset Codebook](https://ucdp.uu.se/downloads/candidateged/ucdp-candidate-codebook1.3.pdf), [UCDP Downloads](https://ucdp.uu.se/downloads/)
- [Global Terrorism Database — START.umd.edu](https://www.start.umd.edu/data-tools/GTD)
- [ReliefWeb API](https://reliefweb.int/help/api), [API docs](https://apidoc.reliefweb.int/)
- [IMB Live Piracy Map — icc-ccs.org/map](https://icc-ccs.org/map/)
