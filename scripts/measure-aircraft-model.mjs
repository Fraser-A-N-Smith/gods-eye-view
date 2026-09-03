#!/usr/bin/env node
/**
 * Measure a baked aircraft GLB (see bake-aircraft-model.mjs) for the three
 * values a new `CLASS_MODEL_REAL` / `MODEL_TRAIL_ANCHOR_NATIVE` entry needs:
 *
 *   - radiusM: half the scene-space bounding-box diagonal.
 *   - bellyM:  the glTF origin's height above the mesh's lowest vertex.
 *   - trailAnchorNative: the aft-belly hull attachment point for the tracked
 *     trail, on the mesh's own centreline (y = 0) profile.
 *
 * Deliberately a STANDALONE reader, not an import from `modelScale.test.mjs`
 * — that file explains its own choice not to export these helpers (reading
 * straight from the GLB keeps the test an independent ground-truth check,
 * not coupled to whatever produced the numbers under test). This script
 * re-implements the identical construction so its output is exactly what
 * that test will independently re-derive and verify — run the test after
 * wiring in whatever this prints, don't just trust this script's own math.
 *
 * Usage:
 *   node scripts/measure-aircraft-model.mjs <model1.glb> [model2.glb ...]
 *
 * Used 2026-08-31 to derive the CLASS_MODEL_REAL and MODEL_TRAIL_ANCHOR_NATIVE
 * entries for public/models/a320.glb and a380.glb.
 */
import fs from 'node:fs';

const GLB_COMPONENT_READERS = {
  5120: (buf, o) => buf.readInt8(o), 5121: (buf, o) => buf.readUInt8(o),
  5122: (buf, o) => buf.readInt16LE(o), 5123: (buf, o) => buf.readUInt16LE(o),
  5125: (buf, o) => buf.readUInt32LE(o), 5126: (buf, o) => buf.readFloatLE(o),
};
const GLB_COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const GLB_TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function glbChunks(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let bin = null;
  for (let off = 20 + jsonLen; off + 8 <= buf.length;) {
    const len = buf.readUInt32LE(off);
    if (buf.readUInt32LE(off + 4) === 0x004e4942) { bin = buf.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len;
  }
  if (!bin) throw new Error(`${file}: no BIN chunk`);
  return { gltf, bin };
}
function glbAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const read = GLB_COMPONENT_READERS[acc.componentType];
  const size = GLB_COMPONENT_BYTES[acc.componentType];
  const n = GLB_TYPE_COMPONENTS[acc.type];
  const bv = gltf.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || size * n;
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    const el = [];
    for (let c = 0; c < n; c++) el.push(read(bin, o + c * size));
    out.push(el);
  }
  return out;
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const t = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const rot = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  return mul([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1], mul(rot, [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]));
}
function transformPoint(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
function nativeMesh(file) {
  const { gltf, bin } = glbChunks(file);
  const verts = []; const tris = [];
  const visit = (idx, parent) => {
    const node = gltf.nodes[idx];
    const m = mul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const pIdx = prim.attributes?.POSITION;
        if (pIdx == null) continue;
        const start = verts.length;
        for (const p of glbAccessor(gltf, bin, pIdx)) verts.push(transformPoint(m, p));
        if (prim.indices != null) {
          const ind = glbAccessor(gltf, bin, prim.indices).map((e) => e[0]);
          for (let i = 0; i + 2 < ind.length; i += 3) tris.push([start + ind[i], start + ind[i + 1], start + ind[i + 2]]);
        } else {
          for (let i = start; i + 2 < verts.length; i += 3) tris.push([i, i + 1, i + 2]);
        }
      }
    }
    for (const child of node.children || []) visit(child, m);
  };
  for (const n of gltf.scenes[gltf.scene ?? 0].nodes) visit(n, IDENTITY);
  if (!verts.length || !tris.length) throw new Error(`${file}: no triangles found`);
  return { verts, tris };
}
function vertexBounds(verts) {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let a = 0; a < 3; a++) { if (v[a] < min[a]) min[a] = v[a]; if (v[a] > max[a]) max[a] = v[a]; }
  return { min, max };
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest point of triangle abc to p (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a); const ac = sub(c, a); const ap = sub(p, a);
  const d1 = dot(ab, ap); const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp); const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
  const cp = sub(p, c);
  const d5 = dot(ab, cp); const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
  const den = 1 / (va + vb + vc); const v = vb * den; const w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}
function distanceToSurface(p, verts, tris) {
  let best = Infinity;
  for (const [i, j, k] of tris) { const d = dist3(p, closestOnTriangle(p, verts[i], verts[j], verts[k])); if (d < best) best = d; }
  return best;
}
/** The hull's longitudinal cross-section: where triangles cross the z = 0 (glTF span axis) plane. */
function centrelineProfile(verts, tris) {
  const pts = [];
  for (const [i, j, k] of tris) {
    const t = [verts[i], verts[j], verts[k]];
    for (let e = 0; e < 3; e++) {
      const a = t[e]; const b = t[(e + 1) % 3];
      if (a[2] === 0) pts.push(a);
      if ((a[2] < 0 && b[2] > 0) || (a[2] > 0 && b[2] < 0)) { const s = a[2] / (a[2] - b[2]); pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, 0]); }
    }
  }
  return pts;
}
/** Closest point of the centreline profile to `target` (segment-exact). */
function closestProfilePoint(target, tris, verts) {
  const segs = [];
  for (const [i, j, k] of tris) {
    const t = [verts[i], verts[j], verts[k]];
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = t[e]; const b = t[(e + 1) % 3];
      if (a[2] === 0) pts.push(a);
      if ((a[2] < 0 && b[2] > 0) || (a[2] > 0 && b[2] < 0)) { const s = a[2] / (a[2] - b[2]); pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, 0]); }
    }
    if (pts.length >= 2) segs.push([pts[0], pts[1]]);
  }
  let best = null; let bestD = Infinity;
  for (const [a, b] of segs) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const den = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    let q = a;
    if (den > 0) {
      let s = ((target[0] - a[0]) * ab[0] + (target[1] - a[1]) * ab[1] + (target[2] - a[2]) * ab[2]) / den;
      s = Math.max(0, Math.min(1, s));
      q = [a[0] + ab[0] * s, a[1] + ab[1] * s, a[2] + ab[2] * s];
    }
    const d = dist3(target, q);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

function measure(file) {
  const { verts, tris } = nativeMesh(file);
  const { min, max } = vertexBounds(verts);
  const centre = min.map((v, a) => (v + max[a]) / 2);
  const radiusM = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  const bellyM = -min[1];
  const corner = [max[0], min[1], 0]; // aft-belly AABB corner
  const profile = centrelineProfile(verts, tris);
  const anchor = closestProfilePoint(corner, tris, verts);
  return {
    file, centre: centre.map((v) => +v.toFixed(4)),
    radiusM: +radiusM.toFixed(4), bellyM: +bellyM.toFixed(4),
    trailAnchorNative: anchor.map((v) => +v.toFixed(4)),
    checks: {
      onHull: distanceToSurface(anchor, verts, tris) <= 1e-4,
      aftOfCentroid: anchor[0] > centre[0],
      aftFraction: +(anchor[0] / max[0]).toFixed(4),
      centrelineExact: anchor[2] === 0,
      originCentred: Math.abs(centre[0]) < 1e-3 && Math.abs(centre[1]) < 1e-3 && Math.abs(centre[2]) < 1e-3,
    },
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/measure-aircraft-model.mjs <model1.glb> [model2.glb ...]');
  process.exit(1);
}
for (const file of files) console.log(JSON.stringify(measure(file), null, 2));
