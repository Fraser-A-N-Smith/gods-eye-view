// src/data/trailSmoothing.js
/**
 * @module trailSmoothing
 * @description Turns a chronological list of REAL observed trail fixes into a
 * denser polyline for rendering, without ever moving, dropping, or inventing
 * a fix. Every input position appears in the output byte-for-byte unchanged,
 * in order — smoothing only inserts interior points BETWEEN reals.
 *
 * This exists because `trailRenderer.js` already draws the trail body as
 * straight GEODESIC chords between raw fixes (correct for long, sparse legs —
 * see its round-8 note), but that leaves a visible kink at every real vertex
 * where a turn happened, even though the live icon glides through the same
 * turn smoothly via `motionModel.js`'s arc-integrated dead-reckoning. This is
 * the tail-side equivalent of that smoothing: purely a rendering choice, not
 * a claim about what was observed between two real fixes.
 *
 * Uses centripetal Catmull-Rom (alpha = 0.5) — the standard choice for
 * smoothing an ordered point sequence because, unlike uniform or chordal
 * parameterization, it cannot cusp or self-intersect on a sharp turn between
 * unevenly spaced points. Runs directly on ECEF Cartesian3: at the segment
 * scale involved (a few hundred meters to a few km — see MAX_SMOOTH_SEGMENT_M)
 * treating the chord as locally Euclidean is a good approximation, and the
 * trail's existing GEODESIC arcType still subdivides each short synthetic
 * segment along the curved earth unchanged.
 */
import * as Cesium from 'cesium';

/** Alpha = 0.5 is the "centripetal" parameterization (0 = uniform, 1 = chordal). */
const CENTRIPETAL_ALPHA = 0.5;

/**
 * Longest real fix-to-fix chord eligible for smoothing (m). Below this, a
 * turn is close enough together that a curve between the two fixes is a
 * reasonable inference. Above it, a segment is left as the straight chord it
 * already renders as today — a sparse, high-speed cruise leg (or a backfilled
 * gap) must not have a curve fabricated across it just because two real fixes
 * happen to be far apart. Sized comfortably above typical low-speed/turning
 * fix spacing (terminal-area maneuvering, holds) and below typical cruise
 * fix spacing (a 900 km/h airliner covers several km per poll interval).
 */
export const MAX_SMOOTH_SEGMENT_M = 4000;

/** Target spacing between generated interior samples (m). */
const TARGET_SAMPLE_SPACING_M = 150;

/** Hard cap on interior samples per segment, independent of length — keeps a
 *  full TRAIL_MAX_POINTS-length trail cheap even if a segment is unusually
 *  long relative to its neighbors. */
const MAX_SAMPLES_PER_SEGMENT = 6;

const _scratchA1 = new Cesium.Cartesian3();
const _scratchA2 = new Cesium.Cartesian3();
const _scratchA3 = new Cesium.Cartesian3();
const _scratchB1 = new Cesium.Cartesian3();
const _scratchB2 = new Cesium.Cartesian3();

/** 2*about - point: the phantom control point used at a path end, so the
 *  curve has a sensible tangent there without a separate end-case formula. */
function mirrorPoint(point, about, out) {
  return Cesium.Cartesian3.subtract(
    Cesium.Cartesian3.multiplyByScalar(about, 2, out),
    point,
    out,
  );
}

/** Centripetal knot spacing between two control points. */
function knotStep(a, b, alpha) {
  return Math.pow(Math.max(Cesium.Cartesian3.distance(a, b), 1e-6), alpha);
}

/**
 * One point on the centripetal Catmull-Rom curve through control points
 * p0..p3, at local parameter u in (0, 1) between p1 and p2.
 */
function catmullRomSample(p0, p1, p2, p3, u, alpha, out) {
  const t0 = 0;
  const t1 = t0 + knotStep(p0, p1, alpha);
  const t2 = t1 + knotStep(p1, p2, alpha);
  const t3 = t2 + knotStep(p2, p3, alpha);
  const t = t1 + u * (t2 - t1);

  Cesium.Cartesian3.lerp(p0, p1, (t - t0) / (t1 - t0), _scratchA1);
  Cesium.Cartesian3.lerp(p1, p2, (t - t1) / (t2 - t1), _scratchA2);
  Cesium.Cartesian3.lerp(p2, p3, (t - t2) / (t3 - t2), _scratchA3);
  Cesium.Cartesian3.lerp(_scratchA1, _scratchA2, (t - t0) / (t2 - t0), _scratchB1);
  Cesium.Cartesian3.lerp(_scratchA2, _scratchA3, (t - t1) / (t3 - t1), _scratchB2);
  return Cesium.Cartesian3.lerp(_scratchB1, _scratchB2, (t - t1) / (t2 - t1), out);
}

/**
 * Insert curved interior samples between real, chronologically-ordered trail
 * fixes for rendering. Every element of `positions` reappears in the output
 * at the same relative order and as the same value — this only adds points.
 *
 * @param {Cesium.Cartesian3[]} positions - Real fixes, oldest first, already
 *   deduplicated (no zero-length segments).
 * @param {object} [options]
 * @param {number} [options.maxSegmentM] - Longest chord eligible for smoothing.
 * @param {number} [options.targetSpacingM] - Target interior-sample spacing.
 * @param {number} [options.maxSamplesPerSegment] - Per-segment sample cap.
 * @returns {Cesium.Cartesian3[]} Denser polyline for display.
 */
export function smoothTrailPositions(positions, options = {}) {
  if (!Array.isArray(positions)) return [];
  if (positions.length < 3) return positions.slice();

  const maxSegmentM = Number.isFinite(options.maxSegmentM)
    ? options.maxSegmentM : MAX_SMOOTH_SEGMENT_M;
  const targetSpacingM = Number.isFinite(options.targetSpacingM) && options.targetSpacingM > 0
    ? options.targetSpacingM : TARGET_SAMPLE_SPACING_M;
  const maxSamplesPerSegment = Number.isFinite(options.maxSamplesPerSegment)
    ? Math.max(0, options.maxSamplesPerSegment) : MAX_SAMPLES_PER_SEGMENT;

  const out = [positions[0]];
  for (let i = 0; i < positions.length - 1; i++) {
    const p1 = positions[i];
    const p2 = positions[i + 1];
    const chordM = Cesium.Cartesian3.distance(p1, p2);
    if (chordM > 0 && chordM <= maxSegmentM) {
      const p0 = i > 0 ? positions[i - 1] : mirrorPoint(p2, p1, new Cesium.Cartesian3());
      const p3 = i + 2 < positions.length
        ? positions[i + 2] : mirrorPoint(p1, p2, new Cesium.Cartesian3());
      const n = Math.min(
        maxSamplesPerSegment,
        Math.max(0, Math.round(chordM / targetSpacingM) - 1),
      );
      for (let k = 1; k <= n; k++) {
        const u = k / (n + 1);
        out.push(catmullRomSample(p0, p1, p2, p3, u, CENTRIPETAL_ALPHA, new Cesium.Cartesian3()));
      }
    }
    out.push(p2);
  }
  return out;
}
