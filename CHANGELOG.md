# Changelog

This changelog records public product changes. For the authoritative description
of current runtime behavior, see [`docs/CURRENT-STATE.md`](docs/CURRENT-STATE.md).

## [Unreleased] — 2026-08-31 (c)

### Added

- Added ReliefWeb (UN OCHA) humanitarian-response context to the cockpit
  Local Info page — country-matched report links, riding along in the
  existing `/api/regional-brief` response as an independently-optional
  field (a ReliefWeb outage never blanks the place/weather/news fields,
  same discipline as the space-weather panel's DONKI/NeoWs fields). Not a
  globe layer: ReliefWeb's reports are country-level, not point-geocoded.
- Added `src/data/iso3166.js`, a static ISO 3166-1 alpha-2→alpha-3 lookup,
  so the existing Nominatim country resolution can also drive ReliefWeb's
  `country.iso3` filter without a second geocoding round-trip.

## [Unreleased] — 2026-08-31 (b)

### Added

- Added an optional ACLED Events layer (`acled-events`), bring-your-own-key
  like the existing Global Fishing Watch vessel-events layer. ACLED's
  regional research teams human-code each record from media, partner, and
  local source reporting — higher confidence than either GDELT layer, still
  not first-hand verification, and every record carries that hedge. Off by
  default; requires the operator's own free `ACLED_API_KEY` +
  `ACLED_API_EMAIL`, and reads `KEY REQUIRED` rather than erroring when
  absent. Free for non-commercial use only under ACLED's own EULA.

## [Unreleased] — 2026-08-31 (a)

### Added

- Added a "Geopolitical Events" globe layer (`gdelt-cameo-events`), backed by
  GDELT's Event Database 2.0 — CAMEO-typed, actor/action-geocoded reported
  events (unrest, conflict, diplomacy presets), distinct from the existing
  "Global Reporting" mentions-only layer. `/api/gdelt/cameo-events` polls
  GDELT's 15-minute bulk export feed and keeps a rolling ~3-hour buffer
  rather than re-fetching a full day of history; a fresh server reads as
  "warming up" instead of empty while it backfills. Every record carries an
  explicit precision flag (country/region/locality) and is presented as a
  reported event, never a confirmed incident.
- The layer's theme switcher has a real, working chip row
  (`getRowControls()`/`setParams`), which the existing mentions layer's own
  preset switcher has never had wired up in the UI.

## [Unreleased] — 2026-08-30 (g)

### Added

- Satellites now also loads CelesTrak's `beidou` group, so the NAV class
  covers all four operational GNSS constellations (GPS, GLONASS, Galileo,
  BeiDou) instead of missing China's fully-global system.
- The tracked ISS card now shows a `CREW · N ABOARD` line, sourced from a new
  `/api/iss-crew` proxy (Open Notify `astros.json`, server-fetched only since
  the upstream is HTTP-only, cached an hour, stale/empty-safe on failure).

### Fixed

- Space Missions' reconstructed (no-supplied-trajectory) orbit rings are no
  longer always a circle: `approximateOrbitPath` now draws named orbits at
  their real published perigee/apogee, so a Geostationary Transfer Orbit
  renders as the visibly elongated ellipse it actually is (~250 km perigee,
  ~35,786 km apogee) instead of a circle pinned at GEO altitude, and Molniya
  orbits render with their real, even more eccentric shape. A final
  Geostationary orbit stays a circular ring but is now correctly equatorial
  regardless of the launch site's own latitude (real GEO satellites reach
  that plane via a later apogee-kick burn).
- The projected launch azimuth for a reconstructed ascent/orbit no longer
  comes from a fixed three-way compass-heading guess (south-southwest for a
  "western North America" bounding box or any "polar"-named orbit, due east
  otherwise, regardless of the actual launch latitude or target orbit). It is
  now derived from the standard orbital-mechanics relation
  sin(azimuth)=cos(inclination)/cos(latitude) using each named orbit's real
  published target inclination, resolving the relation's two mirror solutions
  the way real launch ranges do (prograde missions NE, retrograde/Sun-sync
  missions SW), and clamping to the site's own latitude when the target
  inclination is not directly reachable. A Cape Canaveral ISS-inclination
  mission now projects northeast (matching real published Falcon 9/Soyuz
  crew-launch azimuths) and a Vandenberg Sun-synchronous mission projects
  south (matching real Vandenberg SSO launches) for the correct physical
  reason, instead of both falling into the same hardcoded bucket by name or
  geography.

## [Unreleased] — 2026-08-30 (f)

### Added

- Added `Dockerfile`, `docker-compose.yml` and `.dockerignore`, so the app
  builds and runs with `docker compose up --build` and is reachable at
  `http://localhost:4173`.
- The container runs the Vite dev server rather than serving a static build,
  because every live source reaches its provider through a middleware proxy in
  `vite.config.js`; a built client has none of them and only some implement
  `configurePreviewServer`.
- `HOST` and `PORT` are wired through to the existing `env.HOST` / `env.PORT`
  handling in `vite.config.js`, so the published port works with no CLI flags.
- Keys are supplied at runtime from `.env` via Compose, never copied into the
  image — `.dockerignore` keeps `.env` out of the build context entirely, along
  with `node_modules`, `dist`, caches and the documentation media, taking the
  context from ~449 MB to ~19 MB.
- The proxy disk caches (`.gev-cache`) persist in a named volume, so an
  OpenSky credit ledger or TomTom tile budget is not re-spent on every restart.

### Security

- The container publishes to `127.0.0.1` by default, preserving the app's
  localhost-only posture. It binds `0.0.0.0` *inside* the container because a
  container's loopback is not the host's — that is a reachability requirement,
  not LAN exposure, which is controlled host-side and remains an explicit
  opt-in via `GEV_BIND_ADDR`.
- Compose declares `HOST`/`PORT` in `environment`, which takes precedence over
  `env_file`. `.env.example` documents a `HOST=localhost` line, and a user who
  uncommented it would otherwise bind the server to the container's own
  loopback and get an unreachable app with no obvious cause.

## [Unreleased] — 2026-08-30 (e)

### Fixed

- **The app no longer refuses to start without `GOOGLE_MAPS_API_KEY` (#64).**
  `main.js` hard-threw before the viewer existed, so a missing key produced a
  blank error screen rather than the perfectly good keyless globe the map-stack
  controller has always supported. Photoreal is now acquired through an ordered
  chain — Google direct → Cesium ion's mirror → none — and running out of
  options degrades to the OSM globe instead of to nothing.
- **EEA accounts refused by the Map Tiles API now have a route to photoreal
  (#59).** A Google Maps account billed in the European Economic Area can get a
  401 even with a valid key and live billing. Setting `CESIUM_ION_TOKEN` now
  reaches the same Google tiles through ion's mirror (asset 2275207)
  automatically, per the community workaround in #71.

### Changed

- The startup log and the map-source tray distinguish a credential that was
  never set from one that was set and refused. Those are different problems —
  one is a choice, the other is something the operator needs told about — and
  reporting both as "unavailable" is what made an EEA 401 hard to diagnose.
- `README.md` and `.env.example` no longer describe the Google Maps key as
  required. It is strongly recommended (it buys photoreal, place search and
  geocoding) but the app runs without it.

## [Unreleased] — 2026-08-30 (d)

### Added

- Added **Weather Radar** and **IR Satellite** overlays from RainViewer's free
  public API — two independently toggleable semi-transparent
  `Cesium.ImageryLayer`s on the globe surface. Keyless and CORS-open, so both
  the frame index and the tiles are fetched straight from the browser with no
  server proxy.
- Both overlays share one frame request per cycle: `weather-maps.json` carries
  the radar and satellite frame lists in a single document, and the two layers
  read a shared, coalesced cache rather than fetching it twice.
- A poll that finds the same frame already on screen is a no-op. It does not
  rebuild the imagery layer, which would discard a warm tile cache, re-request
  every visible tile and flicker — all to draw the identical picture.
- A new frame is added BEFORE the old one is removed, so the globe is never
  momentarily bare.
- Added `invalidateFrameCache()` on both layers, so a caller that knows the
  shared cache is stale can force a refresh without waiting out the TTL.

### Changed

- The radar layer states its coverage gap on its own row: radar exists only
  where a radar network does, so a blank area means unwatched, not dry — the
  opposite reading of the same pixels. The satellite row states that infrared
  measures cloud-top temperature, not rainfall.
- Only the newest **observed** radar frame is used. RainViewer also publishes a
  nowcast, which is a forecast; rendering it identically to an observation with
  nothing saying so is the kind of quiet claim this project avoids.

### Fixed

- A stale frame no longer prints an absurd hour count (`24463H 48M OLD`). Past
  a day the readout says the feed looks stalled, which is the actual
  information.

## [Unreleased] — 2026-08-30 (c)

### Added

- Added two independently toggleable open-data raster overlays, drawn as
  `Cesium.ImageryLayer`s on the globe surface: **Sea Marks** (OpenSeaMap —
  buoys, beacons, lighthouses, harbours) and **Ski Pistes** (OpenSnowMap —
  pistes, lifts, nordic trails). Both keyless and ODbL.
- Each overlay reports when it is switched on but not on screen. They draw on
  the Cesium globe, which the app hides whenever Google Photorealistic 3D Tiles
  are active — and photoreal is the default — so the layer row reads
  `HIDDEN ON GOOGLE 3D · SWITCH MAP SOURCE TO SEE THIS` rather than showing a
  lit toggle over an empty globe. Switching to OSM, Bing, GIBS or Sentinel
  reveals it with no reload.
- Both overlays cap their zoom range to what each source actually renders, so
  panning cannot turn into a 404 storm against a volunteer-run tile server.

## [Unreleased] — 2026-08-30 (b)

### Added

- Added a **Global Reporting** layer (GDELT): geocoded event reporting from
  worldwide coverage in 65 languages over the trailing 24 hours. The query
  surface is a closed allowlist of themes — the client sends a preset id and
  the proxy refuses anything else — because GDELT's API will geocode a person's
  name and this project does not build named-person search.
- Added **Weather Alerts** (NOAA NWS) and **Tropical Cyclones** (NOAA NHC).
  Both keyless and US public domain.
- Added **Space Weather** (NOAA SWPC): the OVATION auroral oval and planetary
  K-index, with the operational consequence shown next to the number — a
  geomagnetic storm is simultaneously HF fade, satellite drag and GNSS error.
- Added **Vessel Events** (Global Fishing Watch): AIS gaps, encounters,
  loitering and port visits — the behaviour a live-position layer structurally
  cannot show. Optional `GFW_API_TOKEN`; **CC BY-NC 4.0, non-commercial only**.
- Added **Copernicus Sentinel-1 SAR and Sentinel-2** map sources. Tiles are
  proxied server-side because Copernicus needs an OAuth token that must never
  reach the browser. Optional; the sources stay unavailable, with a stated
  reason, until the server is configured.
- Added `src/data/numeric.js`, shared strict coercion for external feed values.

### Fixed

- A missing planetary K-index no longer reads as a quiet one, and a blank Kp row
  no longer reports 0. Both were the `Number(null) === 0` trap that had already
  produced "0 acres" for wildfires of unknown size; the shared helper now
  prevents the whole class.

### Changed

- Two share-link tests derived their "unknown layer token" from the registry
  instead of hardcoding a letter, which had silently become a registered token.

## [Unreleased] — 2026-08-30

### Added

- Added a rolling history buffer and timeline scrubber (`T`): rewind, play,
  step, and loop the last 30 minutes of the live globe, and export the buffered
  window as JSON. The buffer records only what the session already fetched for
  the layers that were switched on, so rewinding issues no upstream request and
  costs nothing at any provider.
- Added NASA GIBS satellite imagery as two keyless map sources: **Earth Today**
  (VIIRS global daily mosaic) and **GOES GeoColor** (geostationary, ~10 minute
  cadence). Each names its own coverage, because a global mosaic stitched from
  swaths hours apart and a ten-minute view of one hemisphere are different
  pictures of Earth.
- Added a **Fire Perimeters** layer (NIFC / WFIGS): the mapped edge of what has
  burned, complementing the FIRMS hotspot detections already carried.
- Added cross-platform developer entry points so the repository works on
  Windows: `npm run dev:secure` and `npm run opensky:import` are now Node
  scripts rather than bash, and `.gitattributes` pins shell scripts to LF.

### Changed

- Timeline replay asks the flights, military, vessel and fire-perimeter layers
  to stand down while a past frame is on screen, so the present and the past are
  never drawn on top of each other. Suppression is a display state only —
  polling, tracking, click handlers and trails are untouched.
- Key resolution in the cross-platform launcher prefers an explicit environment
  variable over the macOS Keychain. `dev-secure.sh` preferred the Keychain,
  which silently ignored a key the operator had just exported.
- The unit runner now also discovers tests under `scripts/`.

### Fixed

- A wildfire perimeter with an unreadable size now reports "size unknown"
  instead of "0 acres" — `Number(null)` is `0`, and the two are different facts.
- The credential importer no longer writes `.env` one directory above the
  repository, and now tightens an existing `.env` to mode 0600 (the mode option
  on `writeFileSync` applies only when it creates the file).
- The QA matrix runner tears its harness process tree down on Windows, where
  process groups do not exist; it previously left orphaned Chromium instances
  running for the rest of the fleet.

## [Unreleased] — 2026-08-24

### Added

- Added honest aircraft identity narration: callsign, operator, registration,
  type, and route come only from selected-contact context, and missing operator,
  route, or type enrichment is named explicitly.
- Added local, publication-compatible copies of the two README PNGs, with source
  records and third-party-license boundaries in `docs/media/README.md`.
- Added regression coverage for aircraft identity narration and optional-key
  loading feedback.

### Changed

- First-run presentation now opens with Detection `DENSE` at 75%, `ELASTIC`
  allocation, Fade 7%, Outside 1%, scope feather 11%, and aircraft 3D models in
  `PROXIMITY`. Stored state and share links still override these baselines.
- The 17 selected README GIFs remain unchanged and are documented separately
  from the two owner-published PNGs.
- Bundled datacenter and dam snapshots now omit contact-oriented fields and
  note values containing email or phone identifiers. Feature geometry, names,
  operator/capacity/river metadata, counts, and ODbL terms are unchanged.
- Public documentation and the L9 release matrix no longer reference non-public
  planning material or repository history.

### Fixed

- A missing optional FIRMS key no longer turns the complete Environmental
  mission into `LOAD FAILED`. The FIRMS row still reports `KEY REQUIRED`, while
  earthquakes continue to load. Real lifecycle and fetch failures retain
  failure priority.
- The mapped-installations layer retries after an unavailable request when it is
  enabled or the camera settles.
- Aircraft trails attach to the rendered aircraft transform and remain near the
  rear center across headings. Parked aircraft do not draw a moving head
  segment.
- Grounded aircraft keep validated floor evidence through temporary terrain
  outages and wait for measured photoreal-surface evidence before a 3D model
  takes over from its billboard.
- Cockpit altitude uses aviation MSL data rather than Cesium render height.

### Security

- Production transitive dependencies resolve to patched DOMPurify and
  protobufjs releases without changing the Cesium version or application APIs.
- Production dependency audit reports no known advisories; remaining audit
  findings are confined to development and QA tooling.

## [Unreleased] — 2026-08-23

### Added

- Added a first-run mission launcher for Contacts, Space Missions,
  Environmental, and manual exploration.
- Added terrain-validity gating and bounded last-known placement for grounded
  aircraft models.

### Changed

- Environmental consistently presents both earthquakes and NASA FIRMS fires,
  with honest optional-key degradation.
- The tracked aircraft trail acceptance bar is visual: roughly rear-center,
  stable across headings, with minor hull overlap allowed and no conspicuous
  top, bottom, or lateral projection.

## [Unreleased] — 2026-08-18 to 2026-08-22

### Added

- Added the four-source Map Source tray, share-link v2 state, cockpit/context
  voice parity, MSL altitude readouts, and close-range tracked aircraft models.
- Added the L9 release-candidate matrix, AIS feed watchdog, voice cost controls,
  satellite classes, and the shared world-overlay host.
- Added deterministic first-run, map-source, floor, overlay, tracking, and
  aircraft-model regression harnesses.

### Changed

- Consolidated world labels, cards, tracked readouts, CCTV thumbnails, cable
  labels, mission labels, and detection presentation under shared allocation and
  lifecycle rules.
- Reduced idle rendering through the render governor and explicit scope mask.
- Improved cockpit layout, context restoration, keyless feed honesty, and
  aircraft 2D/3D handoffs.

### Fixed

- Fixed degenerate depth picks, map-source restore states, route-camera motion,
  bright-ground label readability, grounded display flooring, and cross-layer
  tracking cleanup.
- Fixed stale overlay callbacks, parked-idle render leaks, cable-label sweep
  starvation, and several share-link state conflicts.

## [Unreleased] — 2026-08-02 to 2026-08-16

### Added

- Added Global Context modes, Cockpit briefing surfaces, Radio context,
  satellite mission replay, and real per-class aircraft models with adjacent
  provenance records.
- Added a shared screen-space overlay system with bounded allocation for labels,
  cards, callouts, detection brackets, and selected-object presentation.

### Changed

- Unified right-side product controls and responsive cockpit/map layouts.
- Migrated public-safe neighborhood geometry to DataSF and tightened safe local
  development defaults.
- Improved proxy resilience, annotation outline bounds, CCTV enable pacing,
  contact de-emphasis, and deterministic visual stacking.

## [Unreleased] — July 2026

### Added

- Added live NASA FIRMS fires, optional live TomTom traffic, Caltrans and TfL
  CCTV packs, CCTV viewsheds and direct-manipulation calibration, citywide CCTV
  cards, Natural Earth regions, analyst queries, and voice routing QA.
- Added the end-to-end vertical-datum system for aircraft, vessels, CCTV,
  annotations, trails, and terrain-aware rendering.
- Added aircraft class silhouettes, path-derived display heading, ADSBDB
  enrichment, cached CelesTrak TLE lookup, and next-ISS-pass prediction.

### Fixed

- Fixed elevated-airport aircraft placement, vessel sea-surface placement,
  close-zoom FIRMS anchors, antimeridian region framing, annotation resolution,
  cross-layer tracking ownership, and CCTV projection lifecycle issues.

## [Unreleased] — June 2026

### Added

- Added OpenAI Realtime voice control, scene-aware entity context, viewport image
  grounding, the AI HUD summary, live AIS vessels, infrastructure layers, map
  source switching, free-text navigation, and server-side data proxies.
- Added hybrid map annotations, 3D aircraft, panoptic detection, tracking
  harnesses, and public data attribution.
- Added MIT source licensing, security guidance, contribution guidance, data
  source notices, and third-party asset boundaries.

### Changed

- Removed the experimental AI video-edit style and retained seven deterministic
  visual styles.
- Moved Realtime text-history trimming to the server-side retention policy while
  keeping only the latest viewport image in conversation context.

## [0.7.0] — 2026-02-18

- Added the Bikeshare Pulse layer and panoptic label improvements.
- Improved tracked-item boxes, post-render alignment, and CCTV projection
  quality.
- Removed the experimental shift-drag CCTV calibration interaction.

## [0.6.0] — 2026-02-10

- Added the initial multi-layer 3D globe experience, visual styles, live
  aircraft, satellites, earthquakes, CCTV, traffic, FIRMS, infrastructure, and
  performance controls.
- Added entity inspection, tracking, scenes, keyboard controls, and shareable
  views.

## [0.1.0] — 2026-02-09

- Initial project version.
