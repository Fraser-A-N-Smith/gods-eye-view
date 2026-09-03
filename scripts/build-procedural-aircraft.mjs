#!/usr/bin/env node
/**
 * Build a low-poly, flat-shaded aircraft GLB from parametric geometry —
 * used for classes with no suitable licensed source asset (`glider`,
 * `fastjet`) where sourcing a real-world model wasn't possible (see
 * docs/FLIGHTS-VISUALIZATION-RESEARCH.md). Every vertex here is
 * author-original: no third-party mesh, no scan, no derivative of any
 * source file — Object.freeze-able facts, not a license carve-out.
 *
 * Geometry is authored directly in this project's target convention (real-
 * world meters, glTF Y-up, nose at local −X, X = length, Z = span) so no
 * separate bake/rotate pass is needed; only a final recenter-to-bbox-centre
 * happens automatically, same as bake-aircraft-model.mjs's own step.
 *
 * Flat shading is deliberate, not a shortcut: CLASS_MODEL_REAL assets render
 * with MODEL_COLOR_BLEND_AMOUNT 0.94 (see aircraftClass.js / flights.js) — the
 * class tint supplies 94% of the surface colour — so per-triangle facets read
 * as a clean low-poly silhouette rather than needing baked texture detail,
 * consistent with atr72.glb's existing "flat abstracted" treatment
 * (public/models/README.md).
 *
 * Usage: node scripts/build-procedural-aircraft.mjs <glider|fastjet> <out.glb>
 */
import fs from 'node:fs';

// --- tiny vector helpers -----------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
}
export function faceNormal(a, b, c) {
  return normalize(cross(sub(b, a), sub(c, a)));
}

/**
 * Accumulates flat-shaded triangles: every triangle gets its own 3 vertices
 * with one shared face normal (no smoothing) — the low-poly "faceted" look.
 */
export class FlatMesh {
  constructor() {
    this.positions = [];
    this.normals = [];
  }
  /** Add one triangle. Vertex winding must be CCW as seen from outside. */
  tri(a, b, c) {
    const n = faceNormal(a, b, c);
    for (const p of [a, b, c]) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
    }
  }
  /** Add a quad (a,b,c,d in CCW order) as two triangles. */
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
}

/**
 * A closed ring profile in the Y-Z plane (fuselage cross-section), symmetric
 * left/right. `count` points evenly spaced by angle around the ring, with
 * separate top/bottom height scales so the ring can be taller above the
 * centreline than below (or vice versa) — e.g. a canopy bulge on top, a
 * flatter belly below.
 */
export function ringProfile(halfWidth, topHeight, bottomHeight, count = 8) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const s = Math.sin(angle);
    const h = s >= 0 ? topHeight : bottomHeight;
    pts.push([halfWidth * Math.cos(angle), h * s]);
  }
  return pts;
}

/**
 * Loft a fuselage through a series of {x, profile} rings (profile = ring of
 * [y,z]... actually [z? — see ringProfile: returns [zLike, yLike] as
 * [halfWidth*cos, h*sin] = [lateral, vertical]), capped with a single apex
 * point at each end (nose/tail point). All rings must share the same point
 * count.
 */
function loftFuselage(mesh, apexNose, rings, apexTail) {
  const n = rings[0].profile.length;
  // Nose cap: fan from apex to the first ring.
  const first = rings[0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [apexNose, 0, 0];
    const b = [first.x, first.profile[i][1], first.profile[i][0]];
    const c = [first.x, first.profile[j][1], first.profile[j][0]];
    mesh.tri(a, c, b); // winding: apex is at -X (behind these points along +X), outward-facing
  }
  // Body: quads between consecutive rings.
  for (let r = 0; r < rings.length - 1; r++) {
    const ra = rings[r];
    const rb = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = [ra.x, ra.profile[i][1], ra.profile[i][0]];
      const b = [ra.x, ra.profile[j][1], ra.profile[j][0]];
      const c = [rb.x, rb.profile[j][1], rb.profile[j][0]];
      const d = [rb.x, rb.profile[i][1], rb.profile[i][0]];
      mesh.quad(a, b, c, d);
    }
  }
  // Tail cap: fan from last ring to apex.
  const last = rings[rings.length - 1];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [apexTail, 0, 0];
    const b = [last.x, last.profile[i][1], last.profile[i][0]];
    const c = [last.x, last.profile[j][1], last.profile[j][0]];
    mesh.tri(a, b, c);
  }
}

/**
 * A thin lifting-surface panel (wing, tailplane, fin): a loft between a root
 * station and a tip station, each station a thin symmetric "plank" defined
 * by {x: leadingEdgeX, xTrail: trailingEdgeX, y: centreY, z, halfThickness}.
 * Builds top skin, bottom skin, leading-edge cap, trailing-edge cap, and tip
 * cap (root is assumed to meet the fuselage and is left open/unwelded, which
 * is fine — it sits inside the fuselage hull and is never seen).
 */
function panel(mesh, root, tip) {
  const rTop = [root.x, root.y + root.halfThickness, root.z];
  const rBot = [root.x, root.y - root.halfThickness, root.z];
  const rTopT = [root.xTrail, root.y + root.halfThickness, root.z];
  const rBotT = [root.xTrail, root.y - root.halfThickness, root.z];
  const tTop = [tip.x, tip.y + tip.halfThickness, tip.z];
  const tBot = [tip.x, tip.y - tip.halfThickness, tip.z];
  const tTopT = [tip.xTrail, tip.y + tip.halfThickness, tip.z];
  const tBotT = [tip.xTrail, tip.y - tip.halfThickness, tip.z];

  const outward = tip.z >= root.z ? 1 : -1; // +Z tip (right side) vs -Z tip (left side, mirrored)
  // Top skin (leading half + trailing half), outward-facing normal (+Y-ish).
  if (outward >= 0) {
    mesh.quad(rTop, tTop, tTopT, rTopT);
    mesh.quad(rBotT, tBotT, tBot, rBot); // bottom skin, facing -Y
    mesh.quad(rBot, tBot, tTop, rTop); // leading edge, facing -X-ish (forward)
    mesh.quad(rTopT, tTopT, tBotT, rBotT); // trailing edge, facing +X-ish (aft)
    mesh.quad(tBot, tBotT, tTopT, tTop); // tip cap
  } else {
    mesh.quad(rTopT, tTopT, tTop, rTop);
    mesh.quad(rBot, tBot, tBotT, rBotT);
    mesh.quad(rTop, tTop, tBot, rBot);
    mesh.quad(rBotT, tBotT, tTopT, rTopT);
    mesh.quad(tTop, tTopT, tBotT, tBot);
  }
}

/** Mirror a panel definition (root/tip stations) to the opposite (-Z) side. */
function mirrorStation(s) {
  return { ...s, z: -s.z };
}

// =====================================================================
// GLIDER — modelled loosely on a modern single-seat sailplane's
// proportions (long, high-aspect unswept wings; slender fuselage;
// T-tail). Length 8.0 m, span 17.0 m, height ~1.9 m — round figures in
// the range of real single-seat/two-seat sailplanes (e.g. ASK-21-class).
// =====================================================================
export function buildGlider() {
  const mesh = new FlatMesh();
  const N = 8;

  const rings = [
    { x: -3.3, profile: ringProfile(0.22, 0.24, 0.20, N) },
    { x: -2.15, profile: ringProfile(0.38, 0.40, 0.28, N) }, // canopy/cockpit, widest
    { x: -0.85, profile: ringProfile(0.36, 0.34, 0.30, N) }, // wing root area
    { x: 1.0, profile: ringProfile(0.26, 0.26, 0.22, N) },
    { x: 2.6, profile: ringProfile(0.14, 0.14, 0.12, N) }, // tailboom
    { x: 3.7, profile: ringProfile(0.05, 0.05, 0.05, N) },
  ];
  loftFuselage(mesh, -4.0, rings, 4.0);

  // Wings: unswept, tapered, mounted mid-fuselage. Half-span 8.5 m/side.
  const wingRoot = { x: -1.05, xTrail: -0.30, y: 0.02, z: 0.36, halfThickness: 0.045 };
  const wingTip = { x: -1.0, xTrail: -0.62, y: 0.10, z: 8.5, halfThickness: 0.02 };
  panel(mesh, wingRoot, wingTip);
  panel(mesh, mirrorStation(wingRoot), mirrorStation(wingTip));

  // T-tail: vertical fin rising from the tailboom...
  const finRoot = { x: 3.35, xTrail: 3.85, y: 0.05, z: 0, halfThickness: 0.035 };
  const finTip = { x: 3.55, xTrail: 3.85, y: 1.05, z: 0, halfThickness: 0.02 };
  // Fin is vertical (spans in Y, not Z) — build it directly rather than via panel()'s Z-mirroring assumption.
  {
    const rTop = [finRoot.x, finRoot.y, finRoot.halfThickness];
    const rBot = [finRoot.x, finRoot.y, -finRoot.halfThickness];
    const rTopT = [finRoot.xTrail, finRoot.y, finRoot.halfThickness];
    const rBotT = [finRoot.xTrail, finRoot.y, -finRoot.halfThickness];
    const tTop = [finTip.x, finTip.y, finTip.halfThickness];
    const tBot = [finTip.x, finTip.y, -finTip.halfThickness];
    const tTopT = [finTip.xTrail, finTip.y, finTip.halfThickness];
    const tBotT = [finTip.xTrail, finTip.y, -finTip.halfThickness];
    mesh.quad(rBot, tBot, tTop, rTop); // +Z face
    mesh.quad(rTopT, tTopT, tBotT, rBotT); // -Z face
    mesh.quad(rBot, tBot, tBotT, rBotT); // leading edge (bottom, since this loft runs root->tip vertically) — actually front face
    mesh.quad(rTop, tTop, tTopT, rTopT); // rear face pairing
    mesh.quad(tBot, tBotT, tTopT, tTop); // tip cap
  }

  // ...horizontal tailplane mounted AT the top of the fin (the "T"). Root z=0
  // so the two mirrored halves meet exactly at the centreline (no gap).
  const tailRoot = { x: 3.45, xTrail: 3.80, y: 1.08, z: 0, halfThickness: 0.025 };
  const tailTip = { x: 3.5, xTrail: 3.65, y: 1.08, z: 1.15, halfThickness: 0.015 };
  panel(mesh, tailRoot, tailTip);
  panel(mesh, mirrorStation(tailRoot), mirrorStation(tailTip));

  return mesh;
}

// =====================================================================
// FASTJET — a generic single-seat swept-wing fighter silhouette (no real
// airframe copied): pointed nose, bubble canopy, swept trapezoidal wings,
// twin canted tail fins, low-mounted stabilators. Length 15.0 m, span
// 10.0 m, height ~4.7 m — round figures in the range of real single-seat
// fighters (e.g. F-16-class).
// =====================================================================
export function buildFastjet() {
  const mesh = new FlatMesh();
  const N = 8;

  const rings = [
    { x: -6.8, profile: ringProfile(0.12, 0.12, 0.12, N) }, // radome
    { x: -5.0, profile: ringProfile(0.34, 0.32, 0.30, N) },
    { x: -3.0, profile: ringProfile(0.52, 0.50, 0.42, N) }, // canopy/cockpit
    { x: -0.5, profile: ringProfile(0.62, 0.52, 0.48, N) }, // intake/wing-root, widest
    { x: 2.2, profile: ringProfile(0.52, 0.46, 0.42, N) },
    { x: 5.0, profile: ringProfile(0.32, 0.30, 0.28, N) },
    { x: 7.0, profile: ringProfile(0.18, 0.18, 0.18, N) }, // nozzle base
  ];
  loftFuselage(mesh, -7.5, rings, 7.5);

  // Wings: swept trapezoid, half-span 5.0 m/side, leading edge swept back.
  const wingRoot = { x: -1.0, xTrail: 2.6, y: -0.05, z: 0.60, halfThickness: 0.06 };
  const wingTip = { x: 2.0, xTrail: 3.2, y: 0.05, z: 5.0, halfThickness: 0.03 };
  panel(mesh, wingRoot, wingTip);
  panel(mesh, mirrorStation(wingRoot), mirrorStation(wingTip));

  // Twin canted tail fins, mounted on the aft fuselage shoulders and
  // splayed outward/upward — built directly (loft runs root->tip in Y,
  // drifting outward in Z as it rises, which IS the cant).
  function finPanel(sign) {
    const root = { x: 4.6, xTrail: 6.3, y: 0.28, z: sign * 0.30, halfThickness: 0.035 };
    const tip = { x: 5.6, xTrail: 6.6, y: 2.15, z: sign * 0.85, halfThickness: 0.02 };
    const outer = sign; // outward face direction
    const rIn = [root.x, root.y, root.z - outer * root.halfThickness];
    const rOut = [root.x, root.y, root.z + outer * root.halfThickness];
    const rInT = [root.xTrail, root.y, root.z - outer * root.halfThickness];
    const rOutT = [root.xTrail, root.y, root.z + outer * root.halfThickness];
    const tIn = [tip.x, tip.y, tip.z - outer * tip.halfThickness];
    const tOut = [tip.x, tip.y, tip.z + outer * tip.halfThickness];
    const tInT = [tip.xTrail, tip.y, tip.z - outer * tip.halfThickness];
    const tOutT = [tip.xTrail, tip.y, tip.z + outer * tip.halfThickness];
    if (outer >= 0) {
      mesh.quad(rIn, tIn, tInT, rInT);
      mesh.quad(rOutT, tOutT, tOut, rOut);
      mesh.quad(rIn, tIn, tOut, rOut);
      mesh.quad(rInT, tInT, tOutT, rOutT);
      mesh.quad(tOut, tOutT, tInT, tIn);
    } else {
      mesh.quad(rInT, tInT, tIn, rIn);
      mesh.quad(rOut, tOut, tOutT, rOutT);
      mesh.quad(rOut, tOut, tIn, rIn);
      mesh.quad(rOutT, tOutT, tInT, rInT);
      mesh.quad(tIn, tInT, tOutT, tOut);
    }
  }
  finPanel(1);
  finPanel(-1);

  // Low-mounted stabilators near the tail.
  const tailRoot = { x: 5.1, xTrail: 6.35, y: -0.10, z: 0.30, halfThickness: 0.03 };
  const tailTip = { x: 5.9, xTrail: 6.75, y: -0.05, z: 1.9, halfThickness: 0.02 };
  panel(mesh, tailRoot, tailTip);
  panel(mesh, mirrorStation(tailRoot), mirrorStation(tailTip));

  return mesh;
}

// --- centre on bbox, write GLB ------------------------------------------

export function recentre(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const centre = min.map((v, a) => (v + max[a]) / 2);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) mesh.positions[i + a] -= centre[a];
  }
  return {
    centreBefore: centre,
    boundsAfter: {
      min: min.map((v, a) => v - centre[a]),
      max: max.map((v, a) => v - centre[a]),
    },
  };
}

function writeGlb(mesh, outFile) {
  const vertexCount = mesh.positions.length / 3;
  const posBuf = Buffer.alloc(vertexCount * 12);
  const normBuf = Buffer.alloc(vertexCount * 12);
  const posMin = [Infinity, Infinity, Infinity];
  const posMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.positions[i * 3 + a];
      posBuf.writeFloatLE(v, i * 12 + a * 4);
      normBuf.writeFloatLE(mesh.normals[i * 3 + a], i * 12 + a * 4);
      if (v < posMin[a]) posMin[a] = v;
      if (v > posMax[a]) posMax[a] = v;
    }
  }
  const bin = Buffer.concat([posBuf, normBuf]);

  const json = {
    asset: { version: '2.0', generator: 'gods-eye-view build-procedural-aircraft.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        material: 0,
        mode: 4, // TRIANGLES
      }],
    }],
    materials: [{
      name: 'flat',
      pbrMetallicRoughness: {
        baseColorFactor: [0.82, 0.83, 0.85, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.6,
      },
      doubleSided: false,
    }],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3',
        min: posMin, max: posMax,
      },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: normBuf.length, target: 34962 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);
  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binChunk.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);

  fs.writeFileSync(outFile, Buffer.concat([header, jsonChunkHeader, jsonChunk, binChunkHeader, binChunk]));
  return { vertexCount, triangleCount: vertexCount / 3 };
}

const BUILDERS = { glider: buildGlider, fastjet: buildFastjet };

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kind, outFile] = process.argv.slice(2);
  if (!BUILDERS[kind] || !outFile) {
    console.error('Usage: node scripts/build-procedural-aircraft.mjs <glider|fastjet> <out.glb>');
    process.exit(1);
  }
  const mesh = BUILDERS[kind]();
  const centring = recentre(mesh);
  const stats = writeGlb(mesh, outFile);
  console.log(JSON.stringify({ kind, outFile, ...stats, ...centring }, null, 2));
}
