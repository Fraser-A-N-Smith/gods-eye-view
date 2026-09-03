# Bundled 3D Model Attribution

Most of the model files in this directory are third-party visual assets. They
are not covered by the repository's MIT source-code license; each remains
available under the license listed below. Two files — `glider.glb` and
`fastjet.glb` — are original, first-party work; see the section below the
third-party table.

| File | Original work and creator | Source | License | Project modifications |
|---|---|---|---|---|
| `airplane.glb` | “boeing 747” by [zairiq-123](https://sketchfab.com/zairiq-123) | [Sketchfab model](https://sketchfab.com/3d-models/boeing-747-9b16672038ba48f98e6d80a159044ed9) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Substantially modified and optimized for God's Eye View, including geometry/material simplification and coordinate/orientation preparation. The former 24× runtime calibration is baked into the mesh; location, rotation, and scale are applied; the bounding-box centre is at the origin; and the model uses glTF +Y-up with its nose toward local −X. Geometry remains uncompressed so the aircraft asset does not compete with photogrammetry for Draco worker capacity. |
| `jet.glb` | “Private Jet” by [Nick the Name](https://sketchfab.com/Nick_The_Name) | [Sketchfab model](https://sketchfab.com/3d-models/private-jet-cbdd1de6ced9461e950eafaa302cc82b) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Repackaged as a glTF binary for the project's military-flight visualization. Imported hierarchy transforms are baked into the meshes; location, rotation, and scale are applied; the bounding-box centre is at the origin; and the model uses meter scale, glTF +Y-up, and the shared nose −X convention. Existing materials are preserved. |
| `ship.glb` | “Low Poly Cargo Ship” by [Javier_Fernandez](https://sketchfab.com/Javier.Fernandez) | [Sketchfab model](https://sketchfab.com/3d-models/low-poly-cargo-ship-4c22cbaf01c1427f8ab60b3a07b1b32c) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Optimized and repackaged as a glTF binary for the project's vessel visualization. |
| `bell206.glb` | “Bell 206 JetRanger” by [terran4627](https://sketchfab.com/terran4627) | [Sketchfab model](https://sketchfab.com/3d-models/bell-206-jetranger-d2f7ba1d671549d4b26aaf834139a1dd) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Optimized for God's Eye View: geometry/material simplification, textures resized to 256 px WebP, orientation/scale vertex-baked to real-world meters (Y-up, nose −X), origin centered. |
| `c172.glb` | “Cessna 172” by [e737](https://sketchfab.com/e0057537) | [Sketchfab model](https://sketchfab.com/3d-models/cessna-172-64cddaee5aff470682659a8c08525046) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Optimized for God's Eye View: geometry/material simplification, textures resized to 256 px WebP, orientation/scale vertex-baked to real-world meters (Y-up, nose −X), origin centered. |
| `citation2.glb` | “1990 Cessna Citation, Texture Detailed, Exterior” by [BlenderCommunityHead](https://sketchfab.com/aboodgoudagad) | [Sketchfab model](https://sketchfab.com/3d-models/1990-cessna-citation-texture-detailed-exterior-a78839624fe64900a8352cb23462350a) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Optimized for God's Eye View: geometry/material simplification, textures resized to 256 px WebP, orientation/scale vertex-baked to real-world meters (Y-up, nose −X), origin centered. |
| `mq9.glb` | “MQ-9” by [IProZenoN](https://sketchfab.com/IProZenoN) | [Sketchfab model](https://sketchfab.com/3d-models/mq-9-fabe963feb354c5584b51f9c470c3f7e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Optimized for God's Eye View: geometry/material simplification, textures resized to 256 px WebP, orientation/scale vertex-baked to real-world meters (Y-up, nose −X), origin centered. |
| `b789.glb` | “Boeing 787-9” by [Nobilis 2](https://sketchfab.com/nobilishornet2) | [Sketchfab model](https://sketchfab.com/3d-models/boeing-787-9-b6711e2e698e4e469675c1154a50b7a3) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Optimized for God's Eye View: geometry/material simplification, textures resized to 256 px WebP, orientation/scale vertex-baked to real-world meters (Y-up, nose −X), origin centered. |
| `atr72.glb` | “ATR 72 - 600” by [Oyan3D](https://sketchfab.com/oyan3D) | [Sketchfab model](https://sketchfab.com/3d-models/atr-72-600-1e1a7186f7444d288675262fcee44744) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Optimized for God's Eye View: geometry/material simplification, textures removed with dominant material colors baked into PBR factors (flat “abstracted” style), orientation/scale vertex-baked to real-world meters (Y-up, nose −X), origin centered. |
| `a320.glb` | “amvlab 3d Aircraft Models — A320” (no-logo variant) by [amvlab](https://github.com/amvlab) | [GitHub repo](https://github.com/amvlab/aircraft-models) (commit `91d835e`, 2026-08-08) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Real per-class asset for the `airliner` class (2026-08-31), replacing the shared `airplane.glb` fallback for this — the app's single most common — class. Re-baked for God's Eye View: origin recentered to the bounding-box centre, rotated 180° about the vertical axis so the nose points glTF −X, and the model's pre-existing Blender-export node rotation/scale folded directly into vertex/normal data (no residual node transform). Real-world meters preserved as shipped (length ≈ 37.7 m against the real A320's ≈ 37.57 m). |
| `a380.glb` | “amvlab 3d Aircraft Models — A380” (no-logo variant) by [amvlab](https://github.com/amvlab) | [GitHub repo](https://github.com/amvlab/aircraft-models) (commit `91d835e`, 2026-08-08) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Real per-class asset for the `quadjet` class (2026-08-31), replacing the shared `airplane.glb` fallback. Re-baked for God's Eye View: origin recentered to the bounding-box centre, rotated 180° about the vertical axis so the nose points glTF −X, node transform folded into vertex/normal data, and uniformly rescaled ×0.4133 — the shipped file was not at real-world meters (measured length ≈176 m before rescale) — to match the real A380's ≈ 72.7 m length (resulting wingspan ≈ 79.1 m against the real ≈ 79.75 m). |

CC BY 4.0 permits sharing and adaptation, including commercial use, provided
appropriate credit is retained, the license is linked, and modifications are
identified. These credits do not imply endorsement by the original creators.

## Original (first-party) models

Unlike the table above, these two are **original work created for this
project** — author-original vertices, no third-party mesh, scan, or
derivative — so they are covered by the repository's normal MIT source
license like any other file, not a third-party carve-out.

| File | What it is | How it was made |
|---|---|---|
| `glider.glb` | Generic single-seat sailplane silhouette for the `glider` class (length 8.0 m, span 17.0 m — round figures in a real sailplane's range; no specific real airframe copied). | Procedurally generated low-poly, flat-shaded mesh — parametric fuselage loft + tapered unswept wings + T-tail, no source asset. See `scripts/build-procedural-aircraft.mjs`. |
| `fastjet.glb` | Generic single-seat swept-wing fighter silhouette for the `fastjet` class (length 15.0 m, span 10.0 m — round figures in a real single-seat fighter's range; no specific real airframe copied). | Procedurally generated low-poly, flat-shaded mesh — parametric fuselage loft + swept wings + twin canted tail fins + stabilators, no source asset. See `scripts/build-procedural-aircraft.mjs`. |

Both exist because no suitable licensed source asset was found for either
class after a bounded search (see
`docs/FLIGHTS-VISUALIZATION-RESEARCH.md`) — `glider` and `fastjet` were the
two remaining `CLASS_MODEL_REAL` classes still on the shared `airplane.glb`
(and, for military `fastjet`, the civilian-shaped `jet.glb`) fallback.
Low-poly and flat-shaded is a deliberate fit, not a limitation: rendered
aircraft carry `MODEL_COLOR_BLEND_AMOUNT` 0.94 (see `aircraftClass.js`), so
the class tint already supplies 94% of the surface colour and per-triangle
facets read as clean silhouette rather than needing texture detail —
consistent with `atr72.glb`'s existing "flat abstracted" treatment above.

**On a review branch, not yet on `main`** — silhouette and proportions were
checked by rendering the actual shipped files (not sketched from memory);
`bellyM`/`radiusM`/trail-anchor values are independently re-measured and
verified by `modelScale.test.mjs`, same as every other `CLASS_MODEL_REAL`
entry. Still worth a human look before merging: these are original,
unreviewed low-poly shapes, not sourced/vetted third-party assets.
