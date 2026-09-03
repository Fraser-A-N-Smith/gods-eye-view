import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  faceNormal, FlatMesh, ringProfile, buildGlider, buildFastjet, recentre,
} from './build-procedural-aircraft.mjs';

test('faceNormal: a right-hand-rule triangle in the XZ plane points along Y', () => {
  // (0,0,-1) -> (1,0,0) -> (0,0,1), viewed from +Y looking down, winds
  // CLOCKWISE — right-hand rule therefore gives a normal pointing -Y, not +Y.
  const n = faceNormal([0, 0, -1], [1, 0, 0], [0, 0, 1]);
  assert.ok(Math.abs(n[0]) < 1e-9 && Math.abs(n[2]) < 1e-9);
  assert.ok(n[1] < -0.99);
  // Reversing the winding flips the normal, as it must.
  const nReversed = faceNormal([0, 0, 1], [1, 0, 0], [0, 0, -1]);
  assert.ok(nReversed[1] > 0.99);
});

test('ringProfile: N points, closed and symmetric left/right', () => {
  const pts = ringProfile(2, 1, 0.5, 8);
  assert.equal(pts.length, 8);
  // Symmetric about z=0: for every point there's a mirror with the same y.
  for (const [z, y] of pts) {
    const mirror = pts.find(([z2, y2]) => Math.abs(z2 + z) < 1e-9 && Math.abs(y2 - y) < 1e-9);
    assert.ok(mirror, `no mirror found for point [${z}, ${y}]`);
  }
  // Top point uses topHeight, bottom point uses bottomHeight.
  const ys = pts.map(([, y]) => y);
  assert.ok(Math.abs(Math.max(...ys) - 1) < 1e-9);
  assert.ok(Math.abs(Math.min(...ys) + 0.5) < 1e-9);
});

test('FlatMesh: every triangle gets 3 unique vertices sharing one face normal', () => {
  const mesh = new FlatMesh();
  mesh.tri([0, 0, 0], [1, 0, 0], [0, 0, 1]);
  assert.equal(mesh.positions.length, 9); // 3 verts x 3 floats
  assert.equal(mesh.normals.length, 9);
  const n0 = mesh.normals.slice(0, 3);
  const n1 = mesh.normals.slice(3, 6);
  const n2 = mesh.normals.slice(6, 9);
  assert.deepEqual(n0, n1);
  assert.deepEqual(n1, n2);
});

test('FlatMesh.quad: splits into two triangles, 6 vertices', () => {
  const mesh = new FlatMesh();
  mesh.quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]);
  assert.equal(mesh.positions.length, 18);
});

function meshBounds(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

for (const [name, build] of [['glider', buildGlider], ['fastjet', buildFastjet]]) {
  test(`${name}: produces a well-formed, finite, non-degenerate mesh`, () => {
    const mesh = build();
    assert.ok(mesh.positions.length > 0);
    assert.equal(mesh.positions.length, mesh.normals.length);
    assert.equal(mesh.positions.length % 9, 0, 'must be whole triangles (3 verts x 3 floats)');
    for (const v of mesh.positions) assert.ok(Number.isFinite(v), 'non-finite position component');
    for (const v of mesh.normals) assert.ok(Number.isFinite(v), 'non-finite normal component');
    // Every normal must be unit length (or the zero-length fallback never hit).
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const len = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      assert.ok(Math.abs(len - 1) < 1e-6, `normal ${i / 3} is not unit length: ${len}`);
    }
  });

  test(`${name}: nose is at the X minimum, tail at the X maximum (nose-at-−X convention)`, () => {
    const mesh = build();
    const { min, max } = meshBounds(mesh);
    // The nose/tail apexes are single points on the centreline (y=0, z=0);
    // confirm the extreme-X vertices sit on the centreline, not out on a wingtip.
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
      if (Math.abs(x - min[0]) < 1e-9) {
        assert.ok(Math.abs(y) < 0.05 && Math.abs(z) < 0.05, `nose vertex off centreline: [${x},${y},${z}]`);
      }
      if (Math.abs(x - max[0]) < 1e-9) {
        assert.ok(Math.abs(y) < 0.05 && Math.abs(z) < 0.05, `tail vertex off centreline: [${x},${y},${z}]`);
      }
    }
  });

  test(`${name}: is symmetric left/right (every vertex has a +Z/−Z mirror)`, () => {
    const mesh = build();
    const verts = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      verts.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    }
    for (const [x, y, z] of verts) {
      if (Math.abs(z) < 1e-9) continue; // on-centreline points are their own mirror
      const hasMirror = verts.some(
        ([x2, y2, z2]) => Math.abs(x2 - x) < 1e-6 && Math.abs(y2 - y) < 1e-6 && Math.abs(z2 + z) < 1e-6,
      );
      assert.ok(hasMirror, `vertex [${x},${y},${z}] has no left/right mirror`);
    }
  });
}

test('recentre: translates the mesh so its bounding box is exactly origin-centred', () => {
  const mesh = new FlatMesh();
  mesh.tri([1, 4, -2], [3, 6, 0], [2, 5, 2]);
  const result = recentre(mesh);
  const { min, max } = meshBounds(mesh);
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs((min[a] + max[a]) / 2) < 1e-9, `axis ${a} not centred: min=${min[a]} max=${max[a]}`);
  }
  assert.deepEqual(result.boundsAfter.min.map((v) => +v.toFixed(6)), min.map((v) => +v.toFixed(6)));
});
