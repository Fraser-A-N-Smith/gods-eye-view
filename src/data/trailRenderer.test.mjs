import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createTrail } from './trailRenderer.js';

test('trail visibility can change without discarding its accumulated geometry', () => {
  const added = [];
  const removed = [];
  const viewer = {
    isDestroyed: () => false,
    entities: {
      add(definition) {
        added.push(definition);
        return definition;
      },
      remove(entity) {
        removed.push(entity);
      },
    },
  };
  const trail = createTrail(viewer, { color: '#ffffff' });
  const positions = [
    new Cesium.Cartesian3(1, 2, 3),
    new Cesium.Cartesian3(4, 5, 6),
  ];

  trail.setVisible(false);
  trail.setPositions(positions);
  assert.equal(added.length, 1);
  assert.equal(added[0].show, false);
  assert.deepEqual(added[0].polyline.positions.getValue(), positions);

  trail.setVisible(true);
  assert.equal(added[0].show, true);
  assert.deepEqual(added[0].polyline.positions.getValue(), positions);

  trail.destroy();
  assert.deepEqual(removed, [added[0]]);
});

test('3+ positions render a smoothed, denser polyline that still starts/ends on the real fixes', () => {
  const added = [];
  const viewer = {
    isDestroyed: () => false,
    entities: {
      add(definition) {
        added.push(definition);
        return definition;
      },
      remove() {},
    },
  };
  const trail = createTrail(viewer, { color: '#ffffff' });
  const positions = [
    new Cesium.Cartesian3(0, 0, 0),
    new Cesium.Cartesian3(1000, 0, 0),
    new Cesium.Cartesian3(1000, 1000, 0),
  ];
  trail.setPositions(positions);
  const rendered = added[0].polyline.positions.getValue();
  assert.ok(rendered.length > positions.length, 'expected interior samples between the real fixes');
  assert.deepEqual(rendered[0], positions[0]);
  assert.deepEqual(rendered[rendered.length - 1], positions[positions.length - 1]);
  for (const real of positions) assert.ok(rendered.includes(real));
});
