# OSINT Source Research — Candidates for Integration

Research pass over public/OSINT data sources **not yet integrated** into God's Eye
View, scoped against the project's actual constraints (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)
and the [Responsible & Open](../README.md#-responsible--open) section of the README):

- **Public data only**, fetched live where its terms don't allow redistribution — never scraped
  against a source's ToS, never private/paywalled.
- **Events, assets, infrastructure, and systems** — not named-person search, face recognition,
  or tracking individuals. A candidate that can only add value by identifying people is out of
  scope regardless of how "open" the data is.
- Each layer is a self-contained module (`src/data/<layer>.js`) with server-side proxying for
  anything needing a key (see [`SECURITY.md`](../SECURITY.md)) — so feasibility below calls out
  where that's cheap (GET + cache) vs. where it needs real plumbing (auth flows, rate budgets,
  polygon/track resolution).

This is a research document, not an implementation — it's meant to seed future "add a data
layer" issues/PRs per `CONTRIBUTING.md`. Existing sources (see [`DATA_SOURCES.md`](../DATA_SOURCES.md))
are not repeated here except where a candidate is a variant/superset worth comparing against one
already in use.

For each candidate: **what it adds**, **license/cost**, **auth**, **feasibility**, and a
recommendation. 🟢 keyless/free · 🟡 free key/account · 🔴 paid or restrictive · ⛔ not recommended.

---

## Aviation

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **GPSJam.org** (uses OpenSky-derived ADS-B data) | Daily GPS jamming/spoofing heatmap, aggregated from aircraft GNSS-vs-ADS-B position deltas — a real "invisible layer" (electronic warfare/jamming zones near conflict areas) that nothing else here surfaces | Data + code CC-licensed by the maintainer (Michal Kučera); daily static GeoJSON tiles, not a live query API | 🟢 | Best fit as a **toggleable overlay**, not a polling layer — tiles refresh once/day. Directly complements the existing Flights and Space Weather layers (GNSS degradation is already discussed there for satellites). **High value, low integration cost.** |
| **FAA NOTAMs / TFRs** (`notams.aim.faa.gov`, or aviationweather.gov) | Temporary flight restrictions — VIP movement, wildfire TFRs, stadium TFRs, launch/reentry windows | US public domain | 🟢 (external API access is inconsistently documented/rate-limited; may require FAA System Wide Information Management (SWIM) registration for the reliable feed) | Good complement to Space Missions (launch TFRs) and Fire layers (wildfire TFRs). **US-only** coverage is the main limitation — flag it the same way CBP Border Wait Times is flagged as a curated US subset. |
| **AVWX / aviationweather.gov METAR-TAF** | Airport-level weather (ceiling, visibility, winds) at any tracked airport | US public domain (NWS-derived) | 🟢 | Narrower version of what Open-Meteo already provides for the cockpit Local Info page — only worth adding if surfaced specifically for **destination airport** context during Final Approach missions, not as a new top-level layer. |

**Recommendation:** GPSJam is the standout — it's a genuinely new *kind* of signal (denial/deception, not just position telemetry) with a trivial integration shape (daily static tiles, no key).

---

## Maritime

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **AISHub** | Community-shared AIS feed — an alternate/redundant vessel source alongside AISStream, with different regional coverage strength (stronger in parts of Europe/Asia) | Free for members who also share a receiver feed; otherwise limited | 🟡 (requires becoming a data-sharing member — not just an API key) | Reciprocity requirement (you must contribute AIS data to get data back) makes this a poor fit for a client-side open-source app with no fixed receiver — **not practical** the way AISStream's simple key model is. |
| **IMB Piracy Reporting Centre** (ICC Commercial Crime Services) | Live piracy/armed-robbery-at-sea incident reports — an actual maritime-security event layer, distinct from AIS "gaps" already covered by Global Fishing Watch | Public incident map; no documented open API (currently HTML/PDF-report driven) | 🔴 (no stable API to build a live proxy against) | Valuable content, weak plumbing. Worth revisiting if ICC ever exposes a structured feed; for now would require scraping an HTML incident map, which conflicts with the "don't scrape against a source's terms/without a clean API" bar. **Defer.** |
| **NOAA CO-OPS Tides & Currents API** | Real-time water level, tide predictions, and current speed at US ports/harbors | US public domain | 🟢 | Nice complement to the existing NOAA National Data Buoy Center layer (which does open-ocean wind/wave, not tidal/harbor). Same integration shape as buoys — small, well-documented REST API. |

**Recommendation:** NOAA CO-OPS is the practical near-term add; AISHub and IMB Piracy are good ideas blocked by access-model/plumbing problems, not by fit.

---

## Space

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **SondeHub** | Live weather-balloon (radiosonde) tracking, including amateur high-altitude balloon flights — genuinely new object class, mid-atmosphere rather than orbital or surface | Free/open project data (Habhub/SondeHub community); API documented and public | 🟢 | Sits nicely between the Flights layer (surface-adjacent) and the Satellites layer (orbital) — a "stratosphere" tier. Positions update every ~minute during active ascents; sparse but real when there's a flight up. **Good, cheap, novel.** |
| **Space-Track.org** | Higher-fidelity TLEs and (with an account) conjunction data messages (CDMs) — actual collision-warning data, a step beyond CelesTrak's public catalog | US government (18th SDS); free registered access, ToS restricts redistribution | 🟡 (free account + login-session auth, more involved than a static API key) | Would upgrade satellite-conjunction storytelling ("these two objects are about to pass close"), but CelesTrak already covers the propagation use case well; CDMs are the actually-new part and require careful server-side session handling. **Medium priority, non-trivial auth.** |

**Recommendation:** SondeHub is a quick, novel add. Space-Track is worth a follow-up investigation specifically for CDMs, not as a TLE replacement.

---

## Ground infrastructure & connectivity

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **IODA** (Internet Outage Detection and Analysis, Georgia Tech) | Live internet-outage signal by country/region (BGP, active probing, darknet traffic) — a genuinely new "is the internet up here" layer that fits the infrastructure theme (submarine cables, datacenters) already in the app | Free, public API, academic project | 🟢 | Strong conceptual fit next to the existing Submarine Cables and Datacenters bundled layers — "the physical backbone" + "is it working" as a pair. Country/region-level granularity (not point features), so it'd render as a choropleth-style overlay rather than markers — different rendering pattern than most current layers. |
| **Cloudflare Radar API** | Internet traffic anomalies, outage detection, and BGP hijack/leak alerts at a global vantage point | Free tier with generous limits; ToS permits non-commercial dashboards | 🟡 | Overlaps IODA's outage-detection niche with a different (and arguably more actively maintained) data source and a real REST API + API-key model that's easy to proxy server-side. **Prefer this over IODA for initial integration** on API ergonomics alone. |
| **NetBlocks** | Human-readable internet shutdown/censorship incident reports, often tied to specific political events | Reports published via site/Twitter; no public structured API | 🔴 | Good narrative value, no stable machine-readable feed — same problem as IMB Piracy. **Defer** until/unless a structured feed appears. |
| **OpenCelliD** | Crowd-sourced cell tower location database | CC BY-SA 4.0 (data), free API with a signup-gated key | 🟡 | Fits the "visible infrastructure" theme (alongside Datacenters/Dams), but the value-add over existing infrastructure layers is unclear, and cell-site density in some regions is thin enough to read as noise rather than signal. **Low priority.** |
| **PowerOutage.us** | Live US utility outage counts by county | Aggregated from utility company data; commercial licensing required for API access beyond a very limited free tier | 🔴 | The interesting global disaster-correlation story (fires/storms → power loss) is blocked by the paid tier. **Not recommended** unless a deployer wants to bring their own paid key, similar to the existing TomTom/GFW BYOK pattern. |

**Recommendation:** Cloudflare Radar is the best next infrastructure layer — real API, free tier, and a novel "is the internet up" signal with no existing analog in the app.

---

## Disaster, environment & humanitarian

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **ReliefWeb API** (UN OCHA) | Structured, geocoded humanitarian disaster reports and situation updates — a curated, higher-signal alternative/complement to the GDELT-driven Global Reporting layer for disaster-specific content | Public, free, documented REST API; UN open data terms | 🟢 | Strong complement to GDACS/NASA EONET (which are automated hazard *detections*) — ReliefWeb adds the human/response-side reporting layer. Straightforward REST integration, same shape as GDACS. |
| **OpenAQ** | Real-time global air-quality measurements (PM2.5, ozone, etc.) from thousands of government and community monitors | Public domain / CC0-adjacent aggregation of government data; free API | 🟢 | Natural pairing with Active Fires and NASA EONET's smoke/haze detections — "what's the air quality downwind of this fire" is a compelling, easy-to-explain mission. Well-documented API, no key required for basic use (a free key raises limits). **High value, low friction.** |
| **Copernicus Emergency Management Service — Rapid Mapping** | On-demand satellite-derived disaster impact maps (flood extents, burn scars, damage assessments) activated for major events | Free and open (Copernicus data policy, same family already used for Sentinel imagery) | 🟢 (some products; full activation list via their portal, not a clean polling API) | Conceptually a great fit (the project already proxies Copernicus Sentinel-1/2), but Rapid Mapping products are per-activation GIS layers (shapefiles/WMS per event) rather than a stable polling endpoint — more like the CCTV "city pack" integration shape (bespoke per event) than a always-on layer. **Interesting, but needs a per-event ingestion design, not a simple proxy.** |
| **VAAC (Volcanic Ash Advisory Centers)** via aviationweather.gov | Volcanic ash cloud advisories — aviation-hazard airspace polygons, complementing the existing Smithsonian Global Volcanism Program eruption points | US/international public data (9 VAACs worldwide; the US ones are on aviationweather.gov) | 🟢 | Good pairing with the existing Volcanoes layer — eruption point → ash cloud polygon → affected airspace ties directly into the Flights layer story. |

**Recommendation:** OpenAQ and ReliefWeb are both straightforward, high-value, low-friction adds. Copernicus Rapid Mapping is worth a dedicated follow-up given its different (per-event) integration shape.

---

## Conflict & human security

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **ACLED** (Armed Conflict Location & Event Data Project) | Structured, geocoded conflict-event data (battles, violence against civilians, protests, riots) with actor/fatality metadata — much higher-fidelity than GDELT's theme-tagged news mentions for this specific use case | Free for registered academic/non-profit/some students; **commercial and general public use requires a paid license** | 🔴 (registration-gated, and general-purpose open-source redistribution likely falls outside the free tier) | The project's GDELT-based Global Reporting layer already covers "protests/conflict, geocoded from news" at a fully open license. ACLED's stricter terms make it a poor default; note it as a **BYOK-style optional layer** (like Global Fishing Watch / TomTom) rather than default-on, and only if a deployer's use case clears ACLED's licensing. |
| **OpenSanctions** | Consolidated global sanctions/PEP/watchlist data — entities and *vessels* (many sanctioned ships have known IMO numbers and last-known positions) | Data under a mix of open licenses per source, aggregation is free for non-commercial use with a paid tier for commercial/API-heavy use | 🟡 | The vessel angle is the actual fit here: cross-referencing AIS/vessel-events data against sanctioned-vessel lists is squarely in the "assets and systems, not people" lane the README draws. Entity/person-level sanctions data should stay out of scope per the no-named-person-tracking line; a vessel-only subset is worth scoping carefully. **Interesting but needs careful scoping to stay on the right side of the project's own ethics line.** |

**Recommendation:** Treat both as optional/BYOK, gated behind explicit scoping work — ACLED for licensing reasons, OpenSanctions to keep strictly to the vessel/asset subset and away from person-level data.

---

## Amateur radio & spectrum

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **APRS-IS** | Live positions from the Automatic Packet Reporting System — ham radio operators, weather stations, and (notably) high-altitude balloon trackers reporting position over RF, worldwide, in real time | Amateur radio is a public service band; APRS-IS access is free but governed by amateur-radio community usage norms (no commercial redistribution of live feeds) | 🟢 (a "verified" or callsign-style login is customary but low-friction) | Directly complements the existing PSKReporter layer (propagation *spots*, not positions) — APRS gives actual moving *positions* of trackers/vehicles/balloons, a genuinely different signal type. Natural pairing with the new SondeHub candidate above for balloon flights. **Good fit, similar integration shape to PSKReporter.** |
| **SatNOGS** | Crowd-sourced satellite ground-station network — observation schedules and telemetry decodes for amateur/cubesat satellites | Open (AGPL-licensed project, CC-BY data) | 🟢 | Niche audience overlap with the existing Satellites layer, but the practical payload (telemetry decode status, not positions — CelesTrak already handles position) is thin value for a global 3D-globe context. **Low priority.** |

**Recommendation:** APRS-IS is a strong, cheap addition alongside PSKReporter and SondeHub — together they'd give the Radio/Space corner of the app a coherent "everything broadcasting position or telemetry over open spectrum" story.

---

## Considered and not recommended

| Source | Why it's out |
|---|---|
| **FlightRadar24 / MarineTraffic (premium tiers)** | Proprietary, ToS explicitly restrict redistribution/reuse the way this project needs; OpenSky+adsb.lol and AISStream already cover the same use case under terms the project can actually operate under. |
| **Shodan / Censys** (internet-connected device/exposure scanning) | Technically "public" data and framed as infrastructure rather than people, which is the project's stated line — but device-level exposure/vulnerability data is a different risk category from position/telemetry data: it's directly actionable for targeting insecure systems, not just visualizing public signals. That cuts against the spirit of a tool meant for exploration/learning rather than attack surface discovery. If ever revisited, it would need to be aggregate-only (e.g., "exposed devices per country" counts) with no device-level drill-down — and even then warrants a deliberate product decision, not a default-on layer. |
| **NetBlocks, IMB Piracy Reporting, PowerOutage.us (free tier), AISHub** | Good content, blocked on access model (no stable open API, reciprocity requirements, or paywalled beyond a token-level free tier) rather than on fit — worth re-checking periodically in case terms/APIs change. |

---

## Summary — suggested next steps in priority order

1. **OpenAQ** (air quality) — clean API, no key required, strong narrative pairing with Fires/EONET smoke detections.
2. **GPSJam** (GPS jamming/spoofing overlay) — daily static tiles, no key, a genuinely new signal type.
3. **ReliefWeb** (humanitarian reporting) — clean REST API, complements GDELT/GDACS.
4. **SondeHub** (radiosonde/balloon tracking) + **APRS-IS** (ham radio positions) as a paired "open spectrum" addition alongside the existing PSKReporter layer.
5. **Cloudflare Radar** (internet outage/BGP anomaly detection) — new infrastructure-health signal alongside Datacenters/Submarine Cables.
6. **NOAA CO-OPS** (tides & currents) — small, well-scoped complement to the existing buoy layer.

Everything else in this document is either blocked on access model (revisit later), needs
deliberate scoping to stay inside the project's own ethics line (ACLED, OpenSanctions), or was
evaluated and rejected outright (Shodan/Censys, proprietary aggregators).
