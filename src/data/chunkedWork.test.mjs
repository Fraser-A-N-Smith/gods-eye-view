// src/data/chunkedWork.test.mjs
// Spreading synchronous per-item work across event-loop turns (traffic.js's
// road-parse loop was blocking the main thread for the full parse — see
// parseRoads in traffic.js). These tests prove two things independently of
// Cesium: every item still gets processed exactly once, and the main thread
// is actually released between chunks (not just "yield_ was called").
import test from 'node:test';
import assert from 'node:assert/strict';
import { processInChunks } from './chunkedWork.js';

test('processes every item exactly once, in order', async () => {
  const items = Array.from({ length: 7 }, (_, i) => i);
  const seen = [];
  const count = await processInChunks(items, (item) => seen.push(item), { chunkSize: 3 });
  assert.deepEqual(seen, items);
  assert.equal(count, 7);
});

test('does not yield at all when everything fits in one chunk', async () => {
  const items = [1, 2, 3];
  let yieldCalls = 0;
  await processInChunks(items, () => {}, {
    chunkSize: 10,
    yield_: () => { yieldCalls += 1; return Promise.resolve(); },
  });
  assert.equal(yieldCalls, 0);
});

test('yields between chunks, not after the last one', async () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  let yieldCalls = 0;
  await processInChunks(items, () => {}, {
    chunkSize: 4,
    yield_: () => { yieldCalls += 1; return Promise.resolve(); },
  });
  // 10 items / chunkSize 4 -> chunks of 4, 4, 2 -> 2 yields between them.
  assert.equal(yieldCalls, 2);
});

test('stops early when shouldAbort trips after a yield', async () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  const seen = [];
  const count = await processInChunks(items, (item) => seen.push(item), {
    chunkSize: 3,
    yield_: () => Promise.resolve(),
    shouldAbort: () => seen.length >= 3,
  });
  assert.equal(count, 3);
  assert.deepEqual(seen, [0, 1, 2]);
});

test('real yieldToMain releases the main thread: another macrotask runs between chunks', async () => {
  const order = [];
  const items = Array.from({ length: 6 }, (_, i) => i);

  const done = processInChunks(items, (item) => order.push(`item:${item}`), { chunkSize: 2 });
  setTimeout(() => order.push('other-task'), 0);
  await done;

  assert.ok(order.includes('other-task'), `expected an interleaved task, got: ${order.join(',')}`);
  const otherIndex = order.indexOf('other-task');
  assert.ok(
    otherIndex > 0 && otherIndex < order.length - 1,
    `expected 'other-task' to land between chunks, got: ${order.join(',')}`
  );
});
