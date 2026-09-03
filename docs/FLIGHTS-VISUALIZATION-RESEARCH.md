# Flights & Aviation Visualization — Improvement Research

Research pass (2026-08-30) into the flights/military-flights layers, scoped to
the two areas raised: 3D model fidelity, and track-line smoothing ("planes
should not make ridiculous vector changes"). This is a findings + recommendation
document, not an implementation — nothing in `src/` changed as part of this
pass.

## Method

Read `src/data/flights.js` (5.4k lines), `src/data/militaryFlights.js` (3.9k),
`src/data/motionModel.js`, `src/data/trailRenderer.js`,
`src/timeline/trackBuffer.js`, `src/data/aircraftClass.js`,
`src/data/aircraftIcons.js`, `public/models/README.md`, `DATA_SOURCES.md`, and
the flights/aircraft passages of `docs/CURRENT-STATE.md` and
`docs/KNOWN-ISSUES.md`.

## What's already strong (do not duplicate)

The live-icon motion pipeline is unusually mature and already addresses most of
what "ridiculous vector changes" usually means. Before proposing smoothing
work, it's worth naming what's already solved so effort doesn't collide with
it:

- **Position is dead-reckoned, not snapped.** `_deadReckon()`
  (`src/data/flights.js:1099`) renders `RENDER_DELAY_SEC` behind wall-clock so
  it can *interpolate* (`Cesium.Cartesian3.lerp`) between two real bracketing
  fixes instead of extrapolating error-prone guesses forward. This runs for
  every fleet aircraft each tick (`_fleetTick`, `flights.js:2619`), not just
  the tracked one.
- **Turns are integrated, not chorded.** When coasting past the newest fix
  (feed lag, warm-up), `arcOffsetEnu()` (`motionModel.js:354`) integrates a
  constant-rate turn from an estimated turn rate
  (`estimateTurnRateDps`/`turnRateFromFixHistory`), rather than projecting a
  straight tangent — a plane in a standard-rate turn stays close to its real
  arc instead of drifting ~90° off after 30s.
- **Course changes are rate-limited.** `limitCourseStep()`
  (`motionModel.js:183`) caps the icon's nose-direction slew per second, with
  a speed-scaled floor (`courseSlewCapDps`) so slow/hovering aircraft don't
  whip their heading at the fleet's 60°/s cap. Hover/near-hover explicitly
  holds the previous course rather than reading GPS jitter as a turn
  (`COURSE_HOLD_SPEED_MPS`).
- **Chord vs. reported-track blending is speed-aware.** `speedRamp()` blends
  the fix-to-fix chord bearing against the reported track by ground speed
  (`COURSE_TRACK_ONLY_MPS` / `COURSE_CHORD_ONLY_MPS`), because a slow turn's
  chord *steps* once per poll while its reported track is smoother — this is a
  documented field-test fix (`motionModel.js:78-105`), not a guess.
- **Stale/gappy feeds coast, they don't freeze-then-jump.**
  `staleCoastLimitSeconds()` bounds how long a contact keeps moving on its last
  known kinematics after its last real contact, avoiding the "stop → teleport"
  cadence a fixed timeout produces.

Net: the **icon's** live motion is already about as smooth as it can honestly
be without fabricating data it doesn't have. This is not the area with
remaining headroom.

## Where the headroom actually is

### 1. The rendered *trail* (history line) is unsmoothed raw chords — real gap

`createTrail()` (`src/data/trailRenderer.js:55`) draws the accumulated fix
history as straight `ArcType.GEODESIC` segments between consecutive real
fixes. GEODESIC only subdivides a segment along the *great circle* for long
legs — it does not soften the *angle* between two segments. So a trail through
a turn, a bit of GPS/ADS-B position jitter, or a course correction still reads
as a visible polyline kink, even though the live icon glides through the same
turn smoothly via the arc-integrated motion model above. This is the one place
where "the plane looks smooth but its tail doesn't" is a real, visible
mismatch.

**Recommendation:** render the trail through a bounded, *interpolating* spline
(e.g. centripetal Catmull-Rom) that passes exactly through every real fix and
only adds curvature *between* them — never displacing a real observation. Two
guardrails to match this codebase's stated honesty invariants
(`trackBuffer.js:9-22`, "a gap stays a gap"; `trailRenderer.js:15-16`, "show
actual tracks, don't style them too much"):

- **Gap-aware:** stop interpolating across any consecutive-fix gap wider than
  the buffer's own `maxInterpolationGapMs`-equivalent for this layer (or the
  segment speed sanity window `estimateTurnRateDps` already uses, 2–120s) —
  render that stretch as the straight chord it actually is, same as today.
- **Bounded sampling:** cap samples per segment (similar in spirit to
  `CORRIDOR_SAMPLE_SPACING_M` in `motionModel.js:248`) so a fast, sparse
  trans-oceanic trail doesn't balloon into thousands of synthetic points.

This is additive rendering only — `_trailPositions` (the source of truth) is
untouched; only the polyline fed to `setPositions()` changes. Low risk, and
directly answers the "ridiculous vector changes" framing as it applies to the
tail, not the nose.

### 2. Civilian 3D models: the most common class still renders a repurposed 747

`CLASS_MODEL_REAL` (`aircraftClass.js:150-157`) ships real per-class GLBs for
`helicopter`, `light`, `bizjet`, `uav`, `widebody`, `turboprop`. The four
classes **not** listed — `airliner`, `quadjet`, `glider`, `fastjet` — still
fall through to the single shared `airplane.glb`
(`CLASS_MODEL_URL`, `aircraftClass.js:132-138`), which is itself a modified
Boeing 747 mesh (`public/models/README.md`), scale-clamped down for whatever
class needs it (`CLASS_SCALE_3D`, `aircraftClass.js:120-127`, explicitly noted
as a stopgap: *"a jet mesh at C172 scale reads wrong... widen when real
per-class models land"*).

`airliner` is the **default fallback class** for any known type code not in a
special set (`classifyAircraft()`, `aircraftClass.js:105`) — i.e. it's the
single most common bucket in ordinary airspace (A320/737-family narrow-bodies).
Up close (the whole point of 3D-model mode), a narrow-body airliner is
rendering as a scaled-down quad-engine widebody. This is the highest-visual-
impact model gap in the app.

**Recommendation, in priority order** (matching how common each class is in
typical live traffic):
1. **`airliner`** — a real narrow-body mesh (A320/737-class). Highest impact:
   most-seen class, currently the most visually wrong.
2. **`fastjet`** — see finding 3 below; currently worse than just "generic."
3. **`quadjet`** — a real four-engine widebody/747-class mesh (the *existing*
   `airplane.glb` 747 could plausibly be re-baked/re-scaled specifically for
   this class once `airliner` has its own asset, instead of being retired).
4. **`glider`** — lowest traffic frequency; lowest priority of the four.

### 3. Military `fastjet` class renders a "Private Jet," not a fighter

`militaryFlights.js:130` maps `fastjet` (and unknown) to `JET_MODEL_URL =
'/models/jet.glb'`, whose own provenance record says it's *"Private Jet" by
Nick the Name* (`public/models/README.md`) — a civilian bizjet-shaped hull.
The `fastjet` class covers F-16/F-15/F-18/F-22/F-35/Su-27/MiG-29/Typhoon/etc.
(`aircraftClass.js:68-73`). At any zoom level where the model is legible, a
slender rounded-nose civilian jet reads as obviously wrong for a delta-wing or
swept-wing fighter silhouette — more so than the airliner-as-747 case, because
the 2D glyph set already draws a distinct, correct fast-jet delta silhouette
(`aircraftIcons.js:150-160`) that the 3D model then contradicts on zoom-in.

**Recommendation:** source a real fast-jet-class GLB (a generic
delta/swept-wing fighter silhouette is fine — this doesn't need to be
airframe-accurate per type) and add it to `CLASS_MODEL_REAL`, replacing
`jet.glb` for `fastjet` in both `aircraftClass.js` and the
`militaryFlights.js` fastjet branch. This is a correctness fix as much as a
polish one.

### 4. Type-level model refinement is already unlocked by existing enrichment, but unused

`_requestTypeEnrichment()` (`flights.js:820`) already fetches real ICAO type
codes from adsbdb (e.g. `A320`, `B738`) and feeds them through
`classifyAircraft({ typeCode, category })` — but the result only ever
resolves to one of the ~10 coarse classes in `CLASS_MODEL_REAL`/
`CLASS_MODEL_URL`. The *specific* type code is available (`meta.typeCode`,
`flights.js:826`) but never used to choose between, say, an A320 mesh and a
737 mesh once `airliner` has more than one real asset.

**Recommendation (stretch, do after #2):** once a second narrow-body asset
exists, add an optional `TYPE_MODEL_REAL` keyed by ICAO type code that
`_modelSpec()`-equivalent lookups check before falling back to
`CLASS_MODEL_REAL[klass]`. Low urgency — one good `airliner` mesh already
closes most of the visual gap; per-type selection is a diminishing-returns
follow-up, not a blocker.

### 5. Non-findings worth recording so they aren't re-investigated

- **Server-side feed fallback (OpenSky → adsb.lol) does not leak into client
  motion.** The fallback happens server-side and the client always consumes
  one normalized shape (`DATA_SOURCES.md` "adsb.lol flight fallback" note) —
  there's no client-visible source-switch discontinuity to fix.
- **Altitude/vertical-rate is already smoothed with the same mechanism as
  lat/lon.** `_deadReckon()`'s bracketing interpolation lerps the full 3D
  `Cesium.Cartesian3` (`flights.js:1154`), which encodes height — climbs/
  descents glide via the same lerp as horizontal motion, not a separate
  (and separately-janky) vertical path.
- **The grounded-floor system already has its own honesty-scoped smoothing**
  (`groundFloor.js`, `_floorGroundedDisplayPosition`) for the "sprite floats
  above/sinks into the runway" problem — unrelated to trail/vector-change
  concerns but easy to conflate; not touched here.

## Suggested priority order

1. Trail-line spline smoothing (finding 1) — small, contained, purely additive
   rendering change; directly answers the stated ask.
2. Real `fastjet` military model (finding 3) — cheapest correctness win (swap
   one asset + two call sites), fixes a visibly wrong silhouette.
3. Real `airliner` civilian model (finding 2.1) — highest visual-impact asset
   work, but requires sourcing/optimizing a new GLB (the existing pipeline is
   manual: geometry/material simplification, 256px WebP textures,
   vertex-baked Y-up/nose −X/meter-scale orientation, per
   `public/models/README.md`'s per-asset notes — there's no automated script
   for this in `scripts/`).
4. Real `quadjet` / `glider` models (finding 2.2–2.3) — same pipeline, lower
   traffic frequency.
5. Per-type model refinement (finding 4) — only once #3 makes it worthwhile.

## Validation approach (matching this repo's existing pattern)

This codebase pins behavior with unit tests close to the math
(`motionModel.test.mjs`, `trackBuffer.test.mjs`) and field-tested visual
invariants recorded in `docs/CURRENT-STATE.md` (e.g. the trail-anchor
acceptance bar at line ~425). Any implementation of the above should follow
the same pattern:
- A pure, Cesium-free smoothing function for the trail spline (like
  `motionModel.js`'s pure math), unit-tested for: passes through every input
  point exactly, respects the gap cutoff, is a no-op on <3 points or on a
  degenerate (repeated-point) segment.
- New model assets get the same provenance-record treatment as the existing
  six in `public/models/README.md` (creator, source, license, exact
  modifications), and a `bellyM`/`radiusM` pin the way `CLASS_MODEL_REAL`'s
  existing entries are commented as "measured from the shipped GLBs — pinned
  by `modelScale.test.mjs`."
