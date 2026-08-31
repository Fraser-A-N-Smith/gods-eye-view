// addUniqueEntity guards the six timer-driven layers' entities.add() loop
// against Cesium's synchronous duplicate-id throw. See the module doc
// comment in entityDedupe.js for the exact failure this replaces: a throw
// mid-loop caught by the layer's broad catch and misreported as a network
// error, while the collection is left half-populated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUniqueEntity } from './entityDedupe.js';

/** Minimal stand-in for a Cesium EntityCollection: throws on a duplicate
 *  id, exactly like the real thing, so a test that calls `.add` directly
 *  (bypassing the helper) still proves the helper is load-bearing. */
function fakeEntityCollection() {
  const ids = new Set();
  return {
    ids,
    add(options) {
      if (ids.has(options.id)) {
        throw new Error(`DeveloperError: An entity with id ${options.id} already exists`);
      }
      ids.add(options.id);
      return options;
    },
  };
}

test('a first-seen id is added and reported as added', () => {
  const entities = fakeEntityCollection();
  const seen = new Set();
  const added = addUniqueEntity(entities, seen, { id: 'a' });
  assert.equal(added, true);
  assert.ok(entities.ids.has('a'));
});

test('a duplicate id within the same pass is skipped, not thrown', () => {
  const entities = fakeEntityCollection();
  const seen = new Set();
  addUniqueEntity(entities, seen, { id: 'dup' });
  assert.doesNotThrow(() => {
    const added = addUniqueEntity(entities, seen, { id: 'dup' });
    assert.equal(added, false);
  });
});

test('a run of records with one repeated id adds every unique one and skips only the repeat', () => {
  const entities = fakeEntityCollection();
  const seen = new Set();
  const records = ['a', 'b', 'a', 'c'];
  const results = records.map((id) => addUniqueEntity(entities, seen, { id }));
  assert.deepEqual(results, [true, true, false, true]);
  assert.deepEqual([...entities.ids].sort(), ['a', 'b', 'c']);
});

test('a fresh Set per pass does not remember the previous pass\'s ids', () => {
  const entitiesPassOne = fakeEntityCollection();
  const seenPassOne = new Set();
  addUniqueEntity(entitiesPassOne, seenPassOne, { id: 'x' });

  // Simulates entities.removeAll() between update() calls: a new
  // EntityCollection stand-in and a fresh Set, as every caller is required
  // to create per pass.
  const entitiesPassTwo = fakeEntityCollection();
  const seenPassTwo = new Set();
  const added = addUniqueEntity(entitiesPassTwo, seenPassTwo, { id: 'x' });
  assert.equal(added, true, 'the same id in a later, independent pass is not a duplicate');
});

test('an entity with no id is rejected rather than added un-tracked', () => {
  const entities = fakeEntityCollection();
  const seen = new Set();
  assert.equal(addUniqueEntity(entities, seen, {}), false);
  assert.equal(addUniqueEntity(entities, seen, { id: null }), false);
  assert.equal(addUniqueEntity(entities, seen, { id: undefined }), false);
  assert.equal(entities.ids.size, 0);
});
