# OSINT Source Research — Candidates for Integration

Research pass over public/OSINT data sources **not yet integrated** into God's Eye
View, scoped against the project's actual constraints (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)
and the [Responsible & Open](../README.md#-responsible--open) section of the README) plus one
hard filter applied throughout this pass:

- **Must be usable at no monetary cost.** Every candidate below has a real, working free
  access path — a keyless endpoint, a free-to-register API key, or a free account with no paid
  tier gating the actual data needed. Sources that are free *in theory* but gate the useful data
  behind a corporate/enterprise license, require operating physical hardware to earn API access,
  or have no working API at any price are filtered out — see [Removed from consideration](#removed-from-consideration--not-free-or-not-workable).
- **Public data only**, fetched live where its terms don't allow redistribution — never scraped
  against a source's ToS, never private/paywalled. A source that's free but restricted to
  **non-commercial** use (the same pattern the app already ships for OpenSky and Global Fishing
  Watch) is kept and flagged, not filtered — free-with-NC-restriction is a known, precedented
  shape in this project, not a "non-match."
- **Events, assets, infrastructure, and systems** — not named-person search, face recognition, or
  tracking individuals. A candidate that can only add value by identifying people is out of scope
  regardless of how open or free the data is.
- Each layer is a self-contained module (`src/data/<layer>.js`) with server-side proxying for
  anything needing a key (see [`SECURITY.md`](../SECURITY.md)) — so feasibility below calls out
  where that's cheap (GET + cache) vs. where it needs real plumbing (auth flows, non-REST
  protocols, rate budgets, per-event ingestion).

This is a research document, not an implementation — it's meant to seed future "add a data
layer" issues/PRs per `CONTRIBUTING.md`. Existing sources (see [`DATA_SOURCES.md`](../DATA_SOURCES.md))
are not repeated here except where a candidate is a variant/superset worth comparing against one
already in use.

🟢 keyless, no signup · 🟡 free key/account required, no paid tier for the needed data ·
🟠 free but non-REST or operationally involved · ⚠️ free with a non-commercial restriction

---

## Aviation

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **GPSJam.org** | Daily GPS jamming/spoofing heatmap, aggregated from ADS-B Exchange aircraft GNSS-vs-reported-position deltas — a real "invisible layer" (electronic warfare/denial zones near conflict areas) nothing else here surfaces | Underlying H3-resolution-4 dataset (John Wiseman) is **CC-BY**, fully free, no NC restriction | 🟢 | Daily static tiles, not a polling API — cheapest possible integration shape. Complements Live Flights and the existing Space Weather (GNSS-degradation) framing. **Top pick.** |
| **FAA NOTAMs / TFRs** (aviationweather.gov / FAA External NOTAM System) | Temporary flight restrictions — VIP movement, wildfire TFRs, stadium TFRs, launch/reentry windows | US public domain | 🟠 | Free, but the reliable machine-readable feed traditionally sits behind FAA SWIM subscriber registration; aviationweather.gov's public NOTAM search is free and keyless but less complete/aviation-grade. Worth a spike to confirm current coverage before committing to a layer. |

---

## Maritime

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **NOAA CO-OPS Tides & Currents API** | Real-time water level, tide predictions, and current speed at US ports/harbors | US public domain | 🟢 | Complements the existing NOAA National Data Buoy Center layer (open-ocean wind/wave vs. harbor tidal state). Same small, well-documented REST shape as the buoy layer already shipped. |

---

## Space & atmosphere

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **SondeHub** | Live weather-balloon (radiosonde) tracking, including amateur high-altitude balloon flights — a genuinely new object class between the Flights layer (surface) and Satellites layer (orbital) | CC BY-SA 2.0, free and open (funded by an Amateur Radio Digital Communications grant + donations, not required to use it) | 🟢 | Real-time streaming API documented and public; rate-limited (poll the state snapshot, then stream). **Cheap, novel, good fit.** |
| **Space-Track.org** | Higher-fidelity TLEs and Conjunction Data Messages (CDMs) — actual collision-warning data, a step beyond CelesTrak's public catalog | US government (18th Space Control Squadron); **fully free**, no paid tier at any level | 🟡 (free registered account + data-use agreement, session-based auth rather than a static key) | Confirmed genuinely free — the only cost is a more involved login flow (30 req/min, 300/hr limits) than a plain API key. CDMs are the actually-new payload; CelesTrak already covers plain propagation well. **Worth a follow-up spike specifically for CDMs.** |

---

## Environment, weather & disaster

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **Open-Meteo Air Quality API** | Real-time + forecast air quality (US AQI, PM2.5, PM10, NO₂, O₃, CO) from Copernicus CAMS, at any point on the globe | Same CC BY 4.0 licence as the Open-Meteo weather endpoint the app **already uses**; free for non-commercial use, 10,000 calls/day with no key | 🟢 ⚠️ | **The best single find of this pass.** This is a second endpoint (`air-quality-api.open-meteo.com`) from the exact provider already integrated for cockpit weather — same licence, same keyless pattern, same attribution line. Pairs naturally with Active Fires/FIRMS and NASA EONET's smoke/haze detections ("what's the air quality downwind of this fire"). Commercial deployments need Open-Meteo's paid tier, same as the existing weather integration already implies. |
| **Open-Meteo Flood API** | Ensemble river-discharge forecasts (up to 30 days) from the Copernicus Global Flood Awareness System (GloFAS) — a genuinely new hazard type (riverine flood forecasting) distinct from GDACS's binary flood/drought alerts | CC BY 4.0, free for non-commercial use, same provider/terms as above | 🟢 ⚠️ | Reaching GloFAS forecast data usually means requesting raw netCDF from Copernicus's FTP service — Open-Meteo already wraps it as clean JSON. Same integration shape and provider as the Air Quality API above; both could ship in the same PR. |
| **Global Wildfire Information System (GWIS/EFFIS)** | Near-real-time **global** fire danger forecast, lightning-ignition risk, and burnt-area perimeters — the existing NIFC Fire Perimeters layer is **US-only**; GWIS is the worldwide equivalent | Copernicus Emergency Management Service data policy — free and open, same family as the Sentinel-1/2 imagery already proxied | 🟢 | Fills a real, named gap: fire perimeters exist today only for the US. Country-profile API is documented and public. |
| **Global Forest Watch (GLAD/RADD deforestation alerts)** | Weekly (GLAD, 30 m) and near-real-time (RADD, 10 m tropics) tree-cover-loss alerts — a slow-motion "event" layer distinct from anything currently on the globe | World Resources Institute + NASA/UMD; open REST/GeoJSON Data API, used commercially today by supply-chain auditors and governments — no NC restriction found | 🟢 | New category entirely: human-driven land-use change as a live layer, sitting well next to Datacenters/Dams as "infrastructure and its footprint." |
| **EMSC (European-Mediterranean Seismological Centre)** | Faster preliminary earthquake detections for Europe/Mediterranean than USGS, via the standard FDSN event web service (SeismicPortal) | Free NGO public-safety service, no commercial restriction found | 🟢 | Complements USGS rather than replacing it — regional speed/density advantage in exactly the region USGS covers thinnest. |
| **WHO Disease Outbreak News** | Structured, geocoded public-health outbreak events (new epidemics, not ongoing case-count dashboards) | WHO public data; official JSON API plus a plain RSS feed, both free, no key | 🟢 | A genuinely new event category — the app currently has no health/epidemiological layer at all. Fits the "Global Reporting" mold (event, not person) cleanly. |
| **USGS Volcano Notification / Message API** | Real-time US volcano status-change messages (alert-level changes, ash advisories) from the five US Volcano Observatories | US public domain | 🟢 | Complements the existing Smithsonian Global Volcanism Program layer (eruption history/points) with live US status changes — narrower scope (US-only) but genuinely real-time where GVP is more of a catalog. |

---

## Internet & infrastructure health

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **Cloudflare Radar API** | Internet traffic anomalies, outage detection, and BGP hijack/leak alerts at global vantage — an "is the internet up here" signal that pairs with the existing Submarine Cables/Datacenters infrastructure layers | Free API; data under **CC BY-NC 4.0** | 🟡 ⚠️ | Real REST API + simple token auth, easy to proxy server-side. NC-flagged the same way the app already flags OpenSky/GFW/TeleGeography — free to run, not for commercial redistribution of the raw data. |
| **IODA** (Internet Outage Detection & Analysis, Georgia Tech/CAIDA) | Country/ASN-level internet outage signal from BGP, active probing, and darknet traffic | Free public-good academic project (Georgia Tech Internet Intelligence Research Lab) | 🟢 | Overlaps Cloudflare Radar's outage-detection niche from an independent methodology; formal API docs are thinner than Radar's, so Radar is the safer first integration with IODA as a secondary/cross-check source later. |

---

## Amateur radio & open spectrum

| Source | What it adds | License / cost | Auth | Notes |
|---|---|---|---|---|
| **APRS-IS** | Live positions from the Automatic Packet Reporting System — trackers, weather stations, and high-altitude balloons reporting position over ham radio, worldwide, real time | Amateur-radio public service band; free, open protocol | 🟠 | Genuinely free but **not a REST API** — it's a plain-text protocol over a raw TCP socket (`rotate.aprs2.net:14580`), using a callsign + numeric "passcode" for a read-only login (no transmit license needed to just receive). Needs a small persistent TCP client server-side, a different shape than every other layer in the app. Pairs naturally with SondeHub for balloon flights and complements PSKReporter's propagation *spots* with actual moving *positions*. |
| **WSPRnet / WSPR.live** | Weak Signal Propagation Reporter spots — another live propagation dataset alongside the existing PSKReporter layer, with an independent contributor network | wspr.live: free for research/non-commercial use, public results only; official WSPRnet API access is available on request from the site maintainer | 🟢 ⚠️ | wspr.live gives a queryable free database today (ClickHouse-backed, documented); direct WSPRnet API access requires reaching out to the maintainer. Largely redundant with PSKReporter's existing niche — worth adding only if wspr.live's independent station network materially improves coverage in practice. |

---

## Considered and rejected as a novel find, but noted for completeness

| Source | Why it's an edge case, not a clean addition |
|---|---|
| **Movebank** (wildlife movement tracking) | Genuinely free and open for many studies (Max Planck Institute/NC Museum of Natural Sciences), but access is **per-study**: some datasets need no login, others require a free account *and* accepting that specific data owner's license terms before use — there's no single blanket "the whole catalog is open" answer. It's also a step outside the project's current asset/infrastructure/event framing (animals aren't infrastructure), so even where data is open it would need a deliberate product decision about fit, not just a plumbing decision. |

---

## Removed from consideration — not free, or not workable

| Source | Why it's out |
|---|---|
| **ACLED** (conflict event data) | The freely-registered `myACLED` tier gives aggregated dashboard-level access only; the disaggregated, geocoded event-level API needed for an actual map layer sits behind Research/Partner/Enterprise tiers, and **commercial use requires a corporate license** outright. Not free for the access level this project would need. |
| **AISHub** | "Free" only in a barter sense — API credentials are earned by *operating your own AIS receiver* and streaming it back with ≥90% uptime and ≥10-vessel coverage over a rolling week. That's a hardware/logistics requirement, not a signup, and isn't something most deployers of this app can meet. |
| **IMB Piracy Reporting Centre** | No structured API at any price — incident data is published as an HTML/PDF map, so there's nothing free-or-otherwise to build a live proxy against. |
| **NetBlocks** (internet shutdown reporting) | Same problem — narrative reports published via site/social channels, no documented structured API. |
| **PowerOutage.us** | Free access is limited to a token public dashboard; the API needed for a live layer requires a commercial data license. |
| **FlightRadar24 / MarineTraffic (premium tiers)**, **Shodan / Censys** | Unchanged from the prior pass: proprietary ToS or, for Shodan/Censys, a risk-category mismatch (device-level exposure data is directly actionable for targeting insecure systems, not just visualization) rather than a pure cost problem — see the original research notes below. |

---

## Summary — suggested next steps in priority order

1. **Open-Meteo Air Quality API + Flood API** — same already-integrated provider, same keyless/free pattern, two new hazard signals (air quality, river flood forecasting) for essentially the cost of two new endpoints.
2. **GPSJam** (GPS jamming/spoofing overlay) — daily static tiles, fully free (CC-BY), a genuinely new signal type.
3. **GWIS/EFFIS** (global wildfire danger + burnt area) — closes the "NIFC is US-only" gap with a free, global Copernicus source.
4. **EMSC** (earthquake) + **WHO Disease Outbreak News** — both free, both new event categories (faster regional seismic, and the first health/epidemiological layer).
5. **Global Forest Watch** (deforestation alerts) — free, open, commercially-unrestricted, and a genuinely new "human footprint" event category next to Datacenters/Dams.
6. **SondeHub** + **APRS-IS** as a paired "open spectrum" addition alongside the existing PSKReporter layer (APRS needs a TCP client rather than REST, so scope it as its own spike).
7. **Cloudflare Radar** (internet outage/BGP anomaly detection, NC-flagged) — new infrastructure-health signal alongside Datacenters/Submarine Cables.
8. **NOAA CO-OPS** (tides & currents) + **USGS Volcano Notification API** — both small, free, well-scoped complements to existing buoy/volcano layers.

Everything else in this document is either an edge-case fit that needs a deliberate product
decision (Movebank), or was checked and found not actually free/workable at the access level
this project needs (see the removed table above).
