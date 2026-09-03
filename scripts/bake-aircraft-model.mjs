#!/usr/bin/env node
/**
 * Bake a source aircraft GLB into this project's model convention (see the
 * comment above `CLASS_MODEL_REAL` in `src/data/aircraftClass.js`): real-world
 * meters, glTF Y-up, nose toward local −X, origin at the bounding-box centre,
 * every node transform folded directly into vertex/normal data (no residual
 * node rotation/scale/translation — `modelScale.test.mjs` rejects that).
 *
 * A source model from an ordinary Blender glTF export usually carries a node
 * rotation+scale (Blender's Z-up → glTF Y-up conversion) and is centred on
 * whatever pivot the modeler used, not the bounding-box centre. This composes
 * that existing node transform with a centering translation plus the given
 * extra rotation/scale, applies the RESULT directly to every vertex position
 * (and, via the correct inverse-transpose, every normal), and clears the
 * node's own transform to identity.
 *
 * Usage:
 *   node scripts/bake-aircraft-model.mjs <in.glb> <out.glb> [rotateYDeg] [uniformScale]
 *
 * `rotateYDeg` is almost always 180 for a source model exported nose-first
 * toward +X (check with a quick render — see the a320/a380 provenance note in
 * public/models/README.md for how those two were verified). `uniformScale`
 * corrects a source file that was not modeled at real-world meters (compare
 * the unbaked bounding-box span, printed by measure-aircraft-model.mjs, against
 * the aircraft's real published dimensions).
 *
 * Used 2026-08-31 to produce public/models/a320.glb and a380.glb from
 * amvlab/aircraft-models (CC BY 4.0); the A380 source needed uniformScale
 * 0.4133 because it was not shipped at real-world meters.
 */
import fs from 'node:fs';

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let offset = 20 + jsonLen;
  let bin = null;
  while (offset < buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const chunkData = buf.subarray(offset + 8, offset + 8 + chunkLen);
    if (chunkType === 0x004e4942) bin = Buffer.from(chunkData); // owned, mutable copy
    offset += 8 + chunkLen;
  }
  if (!bin) throw new Error(`${file}: no BIN chunk`);
  return { json, bin };
}

function writeGlb(json, bin, outFile) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]); // pad with spaces
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]); // pad with zeros

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binChunk.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  fs.writeFileSync(outFile, Buffer.concat([header, jsonChunkHeader, jsonChunk, binChunkHeader, binChunk]));
}

// --- 4x4 column-major matrix helpers (glTF layout) -------------------------
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
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
  return mul(
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1],
    mul(rot, [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1]),
  );
}
const translationMatrix = (tx, ty, tz) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
const scaleMatrix = (k) => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
function rotateYMatrix(deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
function transformPoint(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
const linear3 = (m) => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
function invertTranspose3(a) {
  const [a11, a12, a13, a21, a22, a23, a31, a32, a33] = a;
  const det = a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
  const inv = [
    (a22 * a33 - a23 * a32) / det, -(a21 * a33 - a23 * a31) / det, (a21 * a32 - a22 * a31) / det,
    -(a12 * a33 - a13 * a32) / det, (a11 * a33 - a13 * a31) / det, -(a11 * a32 - a12 * a31) / det,
    (a12 * a23 - a13 * a22) / det, -(a11 * a23 - a13 * a21) / det, (a11 * a22 - a12 * a21) / det,
  ];
  return [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]; // transpose, column-major
}
function transformVector3(l3, v) {
  const [x, y, z] = v;
  return [l3[0] * x + l3[3] * y + l3[6] * z, l3[1] * x + l3[4] * y + l3[7] * z, l3[2] * x + l3[5] * y + l3[8] * z];
}
function normalize(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return len > 1e-12 ? [v[0] / len, v[1] / len, v[2] / len] : v;
}
function accessorStride(json, accessor) {
  return json.bufferViews[accessor.bufferView].byteStride || 12;
}
function accessorByteOffset(json, accessor) {
  const bv = json.bufferViews[accessor.bufferView];
  return (bv.byteOffset || 0) + (accessor.byteOffset || 0);
}

/**
 * @param {string} inFile
 * @param {string} outFile
 * @param {object} [opts]
 * @param {number} [opts.rotateYDeg] - Extra Y-axis rotation (deg) applied after centering.
 * @param {number} [opts.uniformScale] - Extra uniform scale applied after centering.
 * @returns {{worldCenterBefore: number[], boundsAfter: {min: number[], max: number[]}}}
 */
export function bakeAircraftModel(inFile, outFile, opts = {}) {
  const { rotateYDeg = 0, uniformScale = 1 } = opts;
  const { json, bin } = readGlb(inFile);
  const scene = json.scenes[json.scene ?? 0];

  // Pass 1: world-space bbox (existing node transforms applied) so the
  // centering translation is correct.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visits = [];
  function collect(nodeIndex, parentMatrix) {
    const node = json.nodes[nodeIndex];
    const m = mul(parentMatrix, nodeMatrix(node));
    if (node.mesh != null) {
      visits.push({ nodeIndex, worldMatrix: m });
      for (const prim of json.meshes[node.mesh].primitives) {
        const posAcc = json.accessors[prim.attributes.POSITION];
        const stride = accessorStride(json, posAcc);
        const base = accessorByteOffset(json, posAcc);
        for (let i = 0; i < posAcc.count; i++) {
          const o = base + i * stride;
          const world = transformPoint(m, [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
          for (let a = 0; a < 3; a++) {
            if (world[a] < min[a]) min[a] = world[a];
            if (world[a] > max[a]) max[a] = world[a];
          }
        }
      }
    }
    for (const child of node.children || []) collect(child, m);
  }
  for (const rootIndex of scene.nodes) collect(rootIndex, IDENTITY);
  const worldCenter = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  const extraM = mul(
    rotateYMatrix(rotateYDeg),
    mul(scaleMatrix(uniformScale), translationMatrix(-worldCenter[0], -worldCenter[1], -worldCenter[2])),
  );

  // Pass 2: bake finalM = extraM * nodeWorldMatrix into every mesh's raw
  // vertex/normal buffers, then null out that node's own transform.
  const newMin = [Infinity, Infinity, Infinity];
  const newMax = [-Infinity, -Infinity, -Infinity];
  for (const { nodeIndex, worldMatrix } of visits) {
    const finalM = mul(extraM, worldMatrix);
    const normalL3 = invertTranspose3(linear3(finalM));
    const node = json.nodes[nodeIndex];
    for (const prim of json.meshes[node.mesh].primitives) {
      const posAcc = json.accessors[prim.attributes.POSITION];
      const posStride = accessorStride(json, posAcc);
      const posBase = accessorByteOffset(json, posAcc);
      for (let i = 0; i < posAcc.count; i++) {
        const o = posBase + i * posStride;
        const baked = transformPoint(finalM, [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
        bin.writeFloatLE(baked[0], o);
        bin.writeFloatLE(baked[1], o + 4);
        bin.writeFloatLE(baked[2], o + 8);
        for (let a = 0; a < 3; a++) {
          if (baked[a] < newMin[a]) newMin[a] = baked[a];
          if (baked[a] > newMax[a]) newMax[a] = baked[a];
        }
      }
      posAcc.min = newMin;
      posAcc.max = newMax;

      const normAccIdx = prim.attributes.NORMAL;
      if (normAccIdx != null) {
        const normAcc = json.accessors[normAccIdx];
        const nStride = accessorStride(json, normAcc);
        const nBase = accessorByteOffset(json, normAcc);
        for (let i = 0; i < normAcc.count; i++) {
          const o = nBase + i * nStride;
          const baked = normalize(transformVector3(normalL3, [bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]));
          bin.writeFloatLE(baked[0], o);
          bin.writeFloatLE(baked[1], o + 4);
          bin.writeFloatLE(baked[2], o + 8);
        }
      }
    }
    delete node.matrix;
    delete node.rotation;
    delete node.scale;
    delete node.translation;
  }

  writeGlb(json, bin, outFile);
  return { worldCenterBefore: worldCenter, boundsAfter: { min: newMin, max: newMax } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [inFile, outFile, rotateYDeg, uniformScale] = process.argv.slice(2);
  if (!inFile || !outFile) {
    console.error('Usage: node scripts/bake-aircraft-model.mjs <in.glb> <out.glb> [rotateYDeg] [uniformScale]');
    process.exit(1);
  }
  const result = bakeAircraftModel(inFile, outFile, {
    rotateYDeg: rotateYDeg ? Number(rotateYDeg) : 0,
    uniformScale: uniformScale ? Number(uniformScale) : 1,
  });
  console.log(JSON.stringify(result, null, 2));
}
