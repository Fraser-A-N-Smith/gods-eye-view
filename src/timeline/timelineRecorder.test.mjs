// TimelineRecorder — reads the layers' existing analyst-record seam on a timer.
// The rules pinned here are the ones that keep rewind free and honest: no
// upstream request is ever made, a disabled layer stops contributing rather
// than being back-filled, and one broken layer cannot take the recording down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TimelineRecorder,
  gatherFrame,
  RECORDED_SOURCE_IDS,
  SOURCE_LABELS,
} from './timelineRecorder.js';
import { TrackBuffer } from './trackBuffer.js';

const t0 = 1_700_000_000_000;

/** Minimal DataLayerManager stand-in with the two members the recorder uses. */
function fakeManager(spec) {
  const layers = new Map();
  for (const [id, config] of Object.entries(spec)) {
    layers.set(id, { module: config.module ?? {} });
  }
  return {
    layers,
    isEnabled: (id) => spec[id]?.enabled !== false,
    _spec: spec,
  };
}

function records(n, prefix = 'a') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`, icao24: `${prefix}${i}`, lon: i / 10, lat: 0, altitudeM: 9000, heading: 90,
  }));
}

test('every recorded source has a display label', () => {
  for (const id of RECORDED_SOURCE_IDS) {
    assert.ok(SOURCE_LABELS[id], `${id} needs a label for the coverage row`);
  }
});

test('gatherFrame collects from enabled layers that expose the analyst seam', () => {
  const manager = fakeManager({
    flights: { module: { getAnalystRecords: () => records(3) } },
    earthquakes: { module: { getAnalystRecords: () => records(2, 'q') } },
  });
  const frame = gatherFrame(manager);
  assert.equal(frame.flights.length, 3);
  assert.equal(frame.earthquakes.length, 2);
});

test('a DISABLED layer contributes nothing — history stops, it is not back-filled', () => {
  const manager = fakeManager({
    flights: { enabled: false, module: { getAnalystRecords: () => records(5) } },
    earthquakes: { module: { getAnalystRecords: () => records(2, 'q') } },
  });
  const frame = gatherFrame(manager);
  assert.equal(frame.flights, undefined);
  assert.deepEqual(Object.keys(frame), ['earthquakes']);
});

test('a layer without the analyst seam is skipped, not crashed on', () => {
  const manager = fakeManager({
    flights: { module: {} },
    earthquakes: { module: { getAnalystRecords: () => records(1, 'q') } },
  });
  const frame = gatherFrame(manager);
  assert.deepEqual(Object.keys(frame), ['earthquakes']);
});

test('one throwing layer does not take the recording down', () => {
  const manager = fakeManager({
    flights: { module: { getAnalystRecords: () => { throw new Error('layer blew up'); } } },
    earthquakes: { module: { getAnalystRecords: () => records(2, 'q') } },
  });
  const frame = gatherFrame(manager);
  assert.equal(frame.flights, undefined);
  assert.equal(frame.earthquakes.length, 2, 'the healthy layer still records');
});

test('the per-source limit is passed to the layer, not applied after the fact', () => {
  let sawLimit = null;
  const manager = fakeManager({
    flights: { module: { getAnalystRecords: (limit) => { sawLimit = limit; return records(2); } } },
  });
  gatherFrame(manager, { limit: 42 });
  assert.equal(sawLimit, 42, 'the layer does the truncation, so no wasted work');
});

test('COSTS NOTHING UPSTREAM: recording never calls a layer update or fetch', () => {
  let updates = 0;
  const manager = fakeManager({
    flights: {
      module: {
        getAnalystRecords: () => records(2),
        update: () => { updates += 1; },
        enable: () => { updates += 1; },
      },
    },
  });
  const recorder = new TimelineRecorder({ dataManager: manager, now: () => t0 });
  recorder.tick();
  assert.equal(updates, 0, 'the recorder reads snapshots, it does not poll providers');
});

test('tick appends one frame to the buffer', () => {
  const buffer = new TrackBuffer();
  let clock = t0;
  const manager = fakeManager({ flights: { module: { getAnalystRecords: () => records(3) } } });
  const recorder = new TimelineRecorder({ dataManager: manager, buffer, now: () => clock });
  recorder.tick();
  clock += 15_000;
  recorder.tick();
  assert.equal(buffer.frameCount, 2);
  assert.equal(buffer.range().spanMs, 15_000);
});

test('start captures immediately so history begins at once', () => {
  const buffer = new TrackBuffer();
  const manager = fakeManager({ flights: { module: { getAnalystRecords: () => records(1) } } });
  const recorder = new TimelineRecorder({
    dataManager: manager,
    buffer,
    now: () => t0,
    setIntervalFn: () => 'handle',
    clearIntervalFn: () => {},
  });
  recorder.start();
  assert.equal(buffer.frameCount, 1, 'no waiting a full interval for the first frame');
  assert.equal(recorder.running, true);
  recorder.stop();
  assert.equal(recorder.running, false);
});

test('the scheduled callback keeps recording', () => {
  const buffer = new TrackBuffer();
  let clock = t0;
  let scheduled = null;
  const manager = fakeManager({ flights: { module: { getAnalystRecords: () => records(1) } } });
  const recorder = new TimelineRecorder({
    dataManager: manager,
    buffer,
    now: () => clock,
    setIntervalFn: (fn) => { scheduled = fn; return 'handle'; },
    clearIntervalFn: () => {},
  });
  recorder.start();
  for (let i = 1; i <= 3; i += 1) {
    clock += 15_000;
    scheduled();
  }
  assert.equal(buffer.frameCount, 4);
});

test('starting twice does not double-schedule', () => {
  let scheduleCalls = 0;
  const manager = fakeManager({ flights: { module: { getAnalystRecords: () => records(1) } } });
  const recorder = new TimelineRecorder({
    dataManager: manager,
    now: () => t0,
    setIntervalFn: () => { scheduleCalls += 1; return 'handle'; },
    clearIntervalFn: () => {},
  });
  recorder.start();
  recorder.start();
  assert.equal(scheduleCalls, 1);
});

test('change listeners fire on stored frames and unsubscribe cleanly', () => {
  let seen = 0;
  let clock = t0;
  const manager = fakeManager({ flights: { module: { getAnalystRecords: () => records(1) } } });
  const recorder = new TimelineRecorder({ dataManager: manager, now: () => clock });
  const off = recorder.onChange(() => { seen += 1; });
  recorder.tick();
  clock += 15_000;
  recorder.tick();
  assert.equal(seen, 2);
  off();
  clock += 15_000;
  recorder.tick();
  assert.equal(seen, 2, 'unsubscribed listeners stop hearing');
});

test('a throwing listener does not break the recorder', () => {
  const manager = fakeManager({ flights: { module: { getAnalystRecords: () => records(1) } } });
  const recorder = new TimelineRecorder({ dataManager: manager, now: () => t0 });
  recorder.onChange(() => { throw new Error('bad listener'); });
  assert.doesNotThrow(() => recorder.tick());
});

test('recording with every layer off still ticks and stores nothing useful', () => {
  const buffer = new TrackBuffer();
  const manager = fakeManager({ flights: { enabled: false, module: { getAnalystRecords: () => records(3) } } });
  const recorder = new TimelineRecorder({ dataManager: manager, buffer, now: () => t0 });
  recorder.tick();
  assert.equal(buffer.coverage().length, 0, 'nothing was observed, so nothing is claimed');
});

test('an absent or malformed manager is tolerated', () => {
  assert.deepEqual(gatherFrame(null), {});
  assert.deepEqual(gatherFrame({}), {});
  const recorder = new TimelineRecorder({ dataManager: null, now: () => t0 });
  assert.doesNotThrow(() => recorder.tick());
});

test('destroy stops the timer and drops listeners', () => {
  let cleared = null;
  const manager = fakeManager({ flights: { module: { getAnalystRecords: () => records(1) } } });
  const recorder = new TimelineRecorder({
    dataManager: manager,
    now: () => t0,
    setIntervalFn: () => 'handle',
    clearIntervalFn: (h) => { cleared = h; },
  });
  recorder.start();
  recorder.destroy();
  assert.equal(cleared, 'handle');
  assert.equal(recorder.running, false);
});
