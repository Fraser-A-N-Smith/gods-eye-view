// NOAA SWPC space-weather normalization. Two things carry real risk here: the
// OVATION grid arrives with 0–360 longitudes (unwrapped, half the aurora lands
// in the wrong hemisphere), and the Kp product appends rows over time (read the
// wrong end and you report a week-old index as current).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKp,
  parseAuroraGrid,
  parsePlanetaryKp,
  auroraStyle,
  KP_BANDS,
  parseDonkiNotifications,
  parseNeoFeed,
  parseRadioBlackoutScale,
  parseSentryRiskList,
  parseSolarWindNow,
  mergeSpaceWeatherPayload,
  spaceWeatherEnrichmentLabel,
} from './spaceWeatherShape.js';

test('Kp bands are ordered, distinct, and each names an operational effect', () => {
  for (let i = 1; i < KP_BANDS.length; i += 1) {
    assert.ok(KP_BANDS[i].min > KP_BANDS[i - 1].min, 'thresholds ascend');
  }
  assert.equal(new Set(KP_BANDS.map((b) => b.label)).size, KP_BANDS.length);
  assert.equal(new Set(KP_BANDS.map((b) => b.css)).size, KP_BANDS.length);
  for (const band of KP_BANDS) {
    assert.ok(band.effect.length > 10, `${band.label} must say what it means operationally`);
  }
});

test('classifyKp maps an index onto its band', () => {
  assert.equal(classifyKp(0).label, 'QUIET');
  assert.equal(classifyKp(3).label, 'QUIET');
  assert.equal(classifyKp(4).label, 'UNSETTLED');
  assert.equal(classifyKp(5).label, 'G1 STORM');
  assert.equal(classifyKp(7).label, 'G3 STORM');
  assert.equal(classifyKp(9).label, 'G5 STORM');
});

test('an unavailable index is UNKNOWN, never quiet', () => {
  // "No data" rendered as "all clear" is the dangerous direction to fail in.
  for (const input of [null, undefined, NaN, 'nonsense']) {
    const band = classifyKp(input);
    assert.equal(band.label, 'UNKNOWN');
    assert.equal(band.kp, null);
    assert.notEqual(band.label, 'QUIET');
  }
});

test('out-of-range indices clamp rather than falling off the scale', () => {
  assert.equal(classifyKp(-5).label, 'QUIET');
  assert.equal(classifyKp(99).label, 'G5 STORM');
  assert.equal(classifyKp(99).kp, 9);
});

test('LONGITUDE WRAP: the 0–360 grid is converted to −180…180', () => {
  // Unwrapped, everything east of the prime meridian lands on the wrong side
  // of the globe.
  const { points } = parseAuroraGrid({
    coordinates: [[0, 60, 50], [90, 60, 50], [190, 60, 50], [359, 60, 50]],
  });
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  assert.deepEqual(lons, [-170, -1, 0, 90]);
  assert.ok(points.every((p) => p.lon >= -180 && p.lon <= 180));
});

test('the near-empty grid is filtered before it reaches the renderer', () => {
  // SWPC ships ~65k points on a 1x1 degree grid, almost all of them zero.
  const coordinates = [];
  for (let lon = 0; lon < 360; lon += 1) coordinates.push([lon, 0, 0]);
  coordinates.push([10, 70, 45], [11, 70, 60]);
  const { points, dropped } = parseAuroraGrid({ coordinates });
  assert.equal(points.length, 2, 'only points above the threshold survive');
  assert.equal(dropped, 360);
});

test('the grid is ordered brightest-first so a cap keeps the oval, not its fringe', () => {
  const coordinates = [[0, 60, 10], [1, 60, 90], [2, 60, 50]];
  const { points, peak } = parseAuroraGrid({ coordinates }, { maxPoints: 2 });
  assert.deepEqual(points.map((p) => p.probability), [90, 50]);
  assert.equal(peak, 90);
});

test('OVATION timestamps are carried through so the layer can date its forecast', () => {
  const parsed = parseAuroraGrid({
    'Observation Time': '2026-08-30T12:00:00Z',
    'Forecast Time': '2026-08-30T13:00:00Z',
    coordinates: [[0, 70, 40]],
  });
  assert.equal(parsed.observedAt, '2026-08-30T12:00:00Z');
  assert.equal(parsed.forecastAt, '2026-08-30T13:00:00Z');
});

test('a malformed aurora payload yields an empty grid rather than throwing', () => {
  for (const input of [null, {}, { coordinates: null }, { coordinates: [[1, 2]] }, { coordinates: ['x'] }]) {
    const parsed = parseAuroraGrid(input);
    assert.deepEqual(parsed.points, []);
    assert.equal(parsed.peak, 0);
  }
});

test('junk rows inside a good grid are skipped, not fatal', () => {
  const { points } = parseAuroraGrid({
    coordinates: [[0, 70, 40], null, [NaN, 70, 40], [10, 999, 40], 'junk', [20, 70, 40]],
  });
  assert.equal(points.length, 2);
});

test('LATEST ROW: the Kp product appends over time, so the last row is current', () => {
  const payload = [
    ['time_tag', 'Kp', 'a_running', 'station_count'],
    ['2026-08-23T00:00:00', '2.00', '7', '8'],
    ['2026-08-29T21:00:00', '7.33', '48', '8'],
  ];
  const { kp, timeTag } = parsePlanetaryKp(payload);
  assert.ok(Math.abs(kp - 7.33) < 1e-9, 'reading the first row would report a week-old index');
  assert.equal(timeTag, '2026-08-29T21:00:00');
});

test('Kp parsing finds its columns by header name, not by fixed position', () => {
  const payload = [
    ['time_tag', 'station_count', 'Kp'],
    ['2026-08-29T21:00:00', '8', '5.67'],
  ];
  assert.ok(Math.abs(parsePlanetaryKp(payload).kp - 5.67) < 1e-9);
});

test('Kp parsing skips trailing rows with no usable value', () => {
  const payload = [
    ['time_tag', 'Kp'],
    ['2026-08-29T18:00:00', '4.00'],
    ['2026-08-29T21:00:00', ''],
    ['2026-08-30T00:00:00', 'null'],
  ];
  assert.equal(parsePlanetaryKp(payload).kp, 4);
});

test('a malformed Kp payload reports no index rather than guessing one', () => {
  for (const input of [null, [], [['time_tag', 'Kp']], 'nope', [{}]]) {
    assert.deepEqual(parsePlanetaryKp(input), { kp: null, timeTag: null });
  }
});

test('aurora styling scales with probability and vanishes at zero', () => {
  const zero = auroraStyle(0);
  assert.equal(zero.pixelSize, 0);
  assert.equal(zero.alpha, 0);
  const weak = auroraStyle(10);
  const strong = auroraStyle(95);
  assert.ok(weak.alpha < strong.alpha);
  assert.ok(weak.pixelSize < strong.pixelSize);
  assert.notEqual(weak.css, strong.css, 'intensity shifts colour, as real aurora does');
  assert.equal(auroraStyle(NaN).pixelSize, 0);
});

// ── DONKI solar-event notifications ──────────────────────────────────────

test('DONKI notifications map to panel events, newest first', () => {
  const events = parseDonkiNotifications([
    {
      messageType: 'FLR',
      messageID: '2026-08-28-FLR-001',
      messageIssueTime: '2026-08-28T10:00:00Z',
      messageURL: 'https://example.test/flr-001',
      messageBody: 'Preamble text.\n\n## Summary: A significant flare occurred at 09:50 UTC.\n\n## Some other heading\nmore text',
    },
    {
      messageType: 'CME',
      messageID: '2026-08-29-CME-002',
      messageIssueTime: '2026-08-29T12:00:00Z',
      messageURL: 'https://example.test/cme-002',
      messageBody: 'No summary heading here, just a long paragraph of body text that keeps going past two hundred characters so the truncation path has something real to cut, well past the two hundred character mark to be sure it triggers.',
    },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].id, '2026-08-29-CME-002', 'newest issue time sorts first');
  assert.equal(events[0].type, 'CME');
  assert.equal(events[1].summary, 'A significant flare occurred at 09:50 UTC.', 'extracts the Summary paragraph, not the whole body');
  assert.ok(events[0].summary.length <= 200, 'falls back to a ~200-char cap without a Summary heading');
  assert.equal(events[1].url, 'https://example.test/flr-001');
});

test('DONKI summary extraction handles a blank line between the heading and its paragraph', () => {
  // The real production shape: "## Summary:\n\n<paragraph>\n\n## Notes: ...".
  // A naive paragraph-end search matches that leading blank line first and
  // returns "" — this pins the fix.
  const events = parseDonkiNotifications([{
    messageType: 'CME',
    messageID: '20260830-AL-001',
    messageIssueTime: '2026-08-30T07:53Z',
    messageURL: 'https://example.test/al-001',
    messageBody:
      '## Message Type: Space Weather Notification - CME\n##\n\n' +
      '## Summary:\n\nC-type CME detected by STEREO A / GOES / SOHO. \n\n' +
      'Start time of the event: 2026-08-30T01:48Z.\n\n' +
      '## Notes: \n\nThis CME event is associated with a flare.\n',
  }]);
  assert.equal(events[0].summary, 'C-type CME detected by STEREO A / GOES / SOHO.');
});

test('DONKI notifications cap at 20 and skip entries missing required fields', () => {
  const good = Array.from({ length: 25 }, (_, i) => ({
    messageType: 'CME',
    messageID: `id-${i}`,
    messageIssueTime: new Date(2026, 0, 1 + i).toISOString(),
    messageURL: null,
    messageBody: 'body',
  }));
  const junk = [null, {}, { messageType: 'CME' }, { messageType: 'CME', messageID: 'x', messageIssueTime: 'not-a-date' }];
  const events = parseDonkiNotifications([...good, ...junk]);
  assert.equal(events.length, 20);
});

test('a malformed DONKI payload yields no events rather than throwing', () => {
  for (const input of [null, undefined, {}, 'nope', [null, 1, 'x']]) {
    assert.deepEqual(parseDonkiNotifications(input), []);
  }
});

// ── NeoWs close approaches ────────────────────────────────────────────────

test('NeoWs feed flattens by date, sorts closest-first, and coerces numerics', () => {
  const payload = {
    near_earth_objects: {
      '2026-08-30': [
        {
          id: '111',
          name: '(2026 AA1)',
          is_potentially_hazardous_asteroid: false,
          estimated_diameter: { meters: { estimated_diameter_min: 10.5, estimated_diameter_max: 23.4 } },
          close_approach_data: [{
            miss_distance: { kilometers: '5000000' },
            relative_velocity: { kilometers_per_second: '12.3' },
            epoch_date_close_approach: 1756540800000,
          }],
        },
        {
          id: '222',
          name: '(2026 BB2)',
          is_potentially_hazardous_asteroid: true,
          estimated_diameter: { meters: { estimated_diameter_min: 100, estimated_diameter_max: 220 } },
          close_approach_data: [{
            miss_distance: { kilometers: '900000' },
            relative_velocity: { kilometers_per_second: '30.1' },
            epoch_date_close_approach: 1756541000000,
          }],
        },
      ],
    },
  };
  const approaches = parseNeoFeed(payload);
  assert.equal(approaches.length, 2);
  assert.equal(approaches[0].id, '222', 'closest miss distance sorts first');
  assert.ok(Math.abs(approaches[0].missDistanceKm - 900000) < 1e-6);
  assert.ok(Math.abs(approaches[0].velocityKmS - 30.1) < 1e-9);
  assert.equal(approaches[0].hazardous, true);
  assert.equal(approaches[1].hazardous, false);
  assert.equal(approaches[1].diameterMinM, 10.5);
});

test('NeoWs objects lacking a usable close approach are skipped, not fatal', () => {
  const approaches = parseNeoFeed({
    near_earth_objects: {
      '2026-08-30': [
        { id: 'no-approach', name: 'x', close_approach_data: [] },
        { id: 'bad-distance', name: 'x', close_approach_data: [{ miss_distance: {} }] },
        null,
        { name: 'no-id', close_approach_data: [{ miss_distance: { kilometers: '1' } }] },
      ],
    },
  });
  assert.deepEqual(approaches, []);
});

test('a malformed NeoWs payload yields no approaches rather than throwing', () => {
  for (const input of [null, undefined, {}, { near_earth_objects: null }, { near_earth_objects: 'x' }]) {
    assert.deepEqual(parseNeoFeed(input), []);
  }
});

// ── NOAA radio-blackout (R) scale ────────────────────────────────────────

test('the R scale reads today\'s key, not the forecast days', () => {
  const scale = parseRadioBlackoutScale({
    '0': { R: { Scale: '2', Text: 'Moderate radio blackout' } },
    '1': { R: { Scale: '5', Text: 'should not be read' } },
  });
  assert.deepEqual(scale, { scale: '2', text: 'Moderate radio blackout' });
});

test('a missing R entry is null, not a guessed scale', () => {
  for (const input of [null, undefined, {}, { '0': {} }, { '0': { R: null } }, 'nope']) {
    assert.equal(parseRadioBlackoutScale(input), null);
  }
});

// ── mergeSpaceWeatherPayload — the proxy's per-source independent-failure
// guarantee, pulled out of vite.config.js so it is unit-testable here rather
// than only verifiable by reading the proxy's closure. ────────────────────

/** A settled aurora fetch carrying one real cell, well above threshold. */
function fulfilledAurora() {
  return {
    status: 'fulfilled',
    value: {
      'Observation Time': '2026-08-30T12:00:00Z',
      'Forecast Time': '2026-08-30T13:00:00Z',
      coordinates: [[10, 70, 60]],
    },
  };
}

/** A settled Kp fetch reporting a live, non-quiet index. */
function fulfilledKp() {
  return {
    status: 'fulfilled',
    value: [
      ['time_tag', 'Kp'],
      ['2026-08-29T21:00:00', '6.33'],
    ],
  };
}

function fulfilledDonki() {
  return {
    status: 'fulfilled',
    value: [{
      messageType: 'CME',
      messageID: 'evt-1',
      messageIssueTime: '2026-08-29T12:00:00Z',
      messageURL: 'https://example.test/evt-1',
      messageBody: '## Summary:\n\nA CME left the sun.\n\n## Notes:\nmore',
    }],
  };
}

function fulfilledNeo() {
  return {
    status: 'fulfilled',
    value: {
      near_earth_objects: {
        '2026-08-30': [{
          id: '222',
          name: '(2026 BB2)',
          is_potentially_hazardous_asteroid: true,
          estimated_diameter: { meters: { estimated_diameter_min: 100, estimated_diameter_max: 220 } },
          close_approach_data: [{
            miss_distance: { kilometers: '900000' },
            relative_velocity: { kilometers_per_second: '30.1' },
            epoch_date_close_approach: 1756541000000,
          }],
        }],
      },
    },
  };
}

function fulfilledScales() {
  return { status: 'fulfilled', value: { '0': { R: { Scale: '2', Text: 'Moderate radio blackout' } } } };
}

function rejected(message = 'upstream unavailable') {
  return { status: 'rejected', reason: new Error(message) };
}

test('DONKI rejected alone leaves aurora and Kp intact, and empties only solarEvents', () => {
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: fulfilledKp(),
    donkiResult: rejected('DONKI 429'),
    neoResult: fulfilledNeo(),
    scalesResult: fulfilledScales(),
  });
  assert.equal(merged.aurora.length, 1, 'aurora untouched by an unrelated DONKI rejection');
  assert.ok(Math.abs(merged.kp - 6.33) < 1e-9, 'Kp untouched by an unrelated DONKI rejection');
  assert.equal(merged.kpAvailable, true);
  assert.deepEqual(merged.solarEvents, []);
  assert.equal(merged.closeApproaches.length, 1, 'the OTHER optional sources are also untouched');
  assert.deepEqual(merged.radioBlackoutScale, { scale: '2', text: 'Moderate radio blackout' });
});

test('NeoWs rejected alone leaves everything else intact, and empties only closeApproaches', () => {
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: fulfilledKp(),
    donkiResult: fulfilledDonki(),
    neoResult: rejected('NeoWs 429'),
    scalesResult: fulfilledScales(),
  });
  assert.equal(merged.aurora.length, 1);
  assert.ok(Math.abs(merged.kp - 6.33) < 1e-9);
  assert.equal(merged.solarEvents.length, 1);
  assert.deepEqual(merged.closeApproaches, []);
  assert.deepEqual(merged.radioBlackoutScale, { scale: '2', text: 'Moderate radio blackout' });
});

test('NOAA scales rejected alone leaves everything else intact, and nulls only radioBlackoutScale', () => {
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: fulfilledKp(),
    donkiResult: fulfilledDonki(),
    neoResult: fulfilledNeo(),
    scalesResult: rejected('noaa-scales.json 500'),
  });
  assert.equal(merged.aurora.length, 1);
  assert.ok(Math.abs(merged.kp - 6.33) < 1e-9);
  assert.equal(merged.solarEvents.length, 1);
  assert.equal(merged.closeApproaches.length, 1);
  assert.equal(merged.radioBlackoutScale, null);
});

test('THE RISK CASE: all three new sources rejected simultaneously still leaves aurora and Kp intact', () => {
  // This is the exact scenario the task exists to guard: a bad refactor of
  // the merge step letting the new sources' failures blank the pre-existing
  // aurora/Kp contract.
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: fulfilledKp(),
    donkiResult: rejected('DONKI down'),
    neoResult: rejected('NeoWs down'),
    scalesResult: rejected('NOAA scales down'),
  });
  assert.equal(merged.aurora.length, 1, 'aurora survives all three panel sources failing at once');
  assert.ok(Math.abs(merged.kp - 6.33) < 1e-9, 'Kp survives all three panel sources failing at once');
  assert.equal(merged.kpAvailable, true);
  assert.deepEqual(merged.solarEvents, []);
  assert.deepEqual(merged.closeApproaches, []);
  assert.equal(merged.radioBlackoutScale, null);
});

test('a missing Kp alongside all three panel sources failing still draws the aurora oval', () => {
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: rejected('Kp product down'),
    donkiResult: rejected('DONKI down'),
    neoResult: rejected('NeoWs down'),
    scalesResult: rejected('NOAA scales down'),
  });
  assert.equal(merged.aurora.length, 1);
  assert.equal(merged.kp, null);
  assert.equal(merged.kpAvailable, false);
  assert.deepEqual(merged.solarEvents, []);
  assert.deepEqual(merged.closeApproaches, []);
  assert.equal(merged.radioBlackoutScale, null);
});

test('aurora rejected still throws — the one source whose failure is fatal, unchanged by this refactor', () => {
  assert.throws(
    () => mergeSpaceWeatherPayload({
      auroraResult: rejected('ovation_aurora_latest.json 500'),
      kpResult: fulfilledKp(),
      donkiResult: fulfilledDonki(),
      neoResult: fulfilledNeo(),
      scalesResult: fulfilledScales(),
    }),
    /aurora_latest/,
  );
});

test('aurora rejected throws even when every other source also failed', () => {
  assert.throws(
    () => mergeSpaceWeatherPayload({
      auroraResult: rejected('ovation down'),
      kpResult: rejected('kp down'),
      donkiResult: rejected('donki down'),
      neoResult: rejected('neo down'),
      scalesResult: rejected('scales down'),
    }),
    /ovation down/,
  );
});

// ── JPL Sentry impact-risk table ──────────────────────────────────────────

test('Sentry risk list maps every documented field and sorts highest-probability first', () => {
  const payload = {
    data: [
      { des: '2010 RF12', fullname: '(2010 RF12)', diameter: '0.007', ip: '0.026', ps_cum: '-3.32', ts_max: '0', v_inf: '5.3', last_obs: '2022-09-05' },
      { des: '2023 TL4', fullname: '(2023 TL4)', diameter: '0.05', ip: '0.11', ps_cum: '-2.9', ts_max: '0', v_inf: '9.1', last_obs: '2023-11-01' },
    ],
  };
  const objects = parseSentryRiskList(payload);
  assert.equal(objects.length, 2);
  assert.equal(objects[0].designation, '2023 TL4', 'higher impact probability sorts first');
  assert.deepEqual(objects[0], {
    designation: '2023 TL4',
    fullname: '(2023 TL4)',
    diameterKm: 0.05,
    impactProbability: 0.11,
    palermoScale: -2.9,
    torinoScale: 0,
    velocityKmS: 9.1,
    lastObservedDate: '2023-11-01',
  });
});

test('Sentry entries missing a designation are dropped, and the cap/empty/junk cases degrade rather than throw', () => {
  assert.equal(parseSentryRiskList({ data: [{ ip: '0.5' }] }).length, 0, 'no des → dropped');
  assert.deepEqual(parseSentryRiskList(null), []);
  assert.deepEqual(parseSentryRiskList({}), []);
  const many = { data: Array.from({ length: 30 }, (_, i) => ({ des: `obj-${i}`, ip: String(i) })) };
  assert.equal(parseSentryRiskList(many).length, 20, 'caps at maxItems');
  assert.equal(parseSentryRiskList(many)[0].designation, 'obj-29', 'still sorted before the cap is applied');
});

// ── NOAA SWPC real-time solar wind ────────────────────────────────────────

const PLASMA_HEADER = ['time_tag', 'density', 'speed', 'temperature'];
const MAG_HEADER = ['time_tag', 'bx_gsm', 'by_gsm', 'bz_gsm', 'lon_gsm', 'lat_gsm', 'bt'];

test('solar wind reads the LAST row of each product by header name, not position', () => {
  const plasma = [
    PLASMA_HEADER,
    ['2026-08-30 00:00:00.000', '4.1', '380.2', '95000'],
    ['2026-08-30 00:01:00.000', '4.3', '402.7', '97000'],
  ];
  const mag = [
    MAG_HEADER,
    ['2026-08-30 00:00:00.000', '1.1', '-2.2', '-3.3', '10', '5', '4.5'],
    ['2026-08-30 00:01:00.000', '1.4', '-2.6', '-5.1', '11', '6', '5.9'],
  ];
  const result = parseSolarWindNow(plasma, mag);
  assert.deepEqual(result, {
    speedKmS: 402.7,
    density: 4.3,
    bz: -5.1,
    bt: 5.9,
    sampledAtMs: Date.parse('2026-08-30 00:01:00.000Z'),
  });
});

test('solar wind: a missing plasma or mag product nulls only its own fields, not both', () => {
  const plasma = [PLASMA_HEADER, ['2026-08-30 00:01:00.000', '4.3', '402.7', '97000']];
  const mag = [MAG_HEADER, ['2026-08-30 00:01:00.000', '1.4', '-2.6', '-5.1', '11', '6', '5.9']];

  const plasmaOnly = parseSolarWindNow(plasma, null);
  assert.equal(plasmaOnly.speedKmS, 402.7);
  assert.equal(plasmaOnly.density, 4.3);
  assert.equal(plasmaOnly.bz, null);
  assert.equal(plasmaOnly.bt, null);

  const magOnly = parseSolarWindNow(null, mag);
  assert.equal(magOnly.speedKmS, null);
  assert.equal(magOnly.density, null);
  assert.equal(magOnly.bz, -5.1);
  assert.equal(magOnly.bt, 5.9);
});

test('solar wind: both products missing/malformed yields an all-null reading rather than throwing', () => {
  assert.deepEqual(parseSolarWindNow(null, null), {
    speedKmS: null, density: null, bz: null, bt: null, sampledAtMs: null,
  });
  assert.deepEqual(parseSolarWindNow({ not: 'an array' }, undefined), {
    speedKmS: null, density: null, bz: null, bt: null, sampledAtMs: null,
  });
  assert.deepEqual(parseSolarWindNow([PLASMA_HEADER], [MAG_HEADER]), {
    speedKmS: null, density: null, bz: null, bt: null, sampledAtMs: null,
  }, 'a header row with no data row is not a reading');
});

// ── Sentry/solar-wind wired into the eight-source merge ──────────────────

function fulfilledSentry() {
  return { status: 'fulfilled', value: { data: [{ des: '2023 TL4', ip: '0.11' }] } };
}
function fulfilledPlasma() {
  return { status: 'fulfilled', value: [PLASMA_HEADER, ['2026-08-30 00:01:00.000', '4.3', '402.7', '97000']] };
}
function fulfilledMag() {
  return { status: 'fulfilled', value: [MAG_HEADER, ['2026-08-30 00:01:00.000', '1.4', '-2.6', '-5.1', '11', '6', '5.9']] };
}

test('a merged payload carrying Sentry and both solar-wind products surfaces impactRiskObjects and solarWindNow', () => {
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: fulfilledKp(),
    donkiResult: fulfilledDonki(),
    neoResult: fulfilledNeo(),
    scalesResult: fulfilledScales(),
    sentryResult: fulfilledSentry(),
    plasmaResult: fulfilledPlasma(),
    magResult: fulfilledMag(),
  });
  assert.equal(merged.impactRiskObjects.length, 1);
  assert.equal(merged.impactRiskObjects[0].designation, '2023 TL4');
  assert.equal(merged.solarWindNow.speedKmS, 402.7);
  assert.equal(merged.solarWindNow.bz, -5.1);
});

test('Sentry/plasma/mag rejected leaves aurora, Kp, and the five pre-existing fields intact', () => {
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: fulfilledKp(),
    donkiResult: fulfilledDonki(),
    neoResult: fulfilledNeo(),
    scalesResult: fulfilledScales(),
    sentryResult: rejected('sentry.api 500'),
    plasmaResult: rejected('plasma-7-day.json 500'),
    magResult: rejected('mag-7-day.json 500'),
  });
  assert.equal(merged.aurora.length, 1);
  assert.ok(Math.abs(merged.kp - 6.33) < 1e-9);
  assert.equal(merged.solarEvents.length, 1);
  assert.equal(merged.closeApproaches.length, 1);
  assert.deepEqual(merged.radioBlackoutScale, { scale: '2', text: 'Moderate radio blackout' });
  assert.deepEqual(merged.impactRiskObjects, []);
  assert.equal(merged.solarWindNow, null, 'both solar-wind sources down together yields null, not a half-filled object');
});

test('omitting the three new result params entirely (call-site not yet upgraded) still merges cleanly', () => {
  const merged = mergeSpaceWeatherPayload({
    auroraResult: fulfilledAurora(),
    kpResult: fulfilledKp(),
    donkiResult: fulfilledDonki(),
    neoResult: fulfilledNeo(),
    scalesResult: fulfilledScales(),
  });
  assert.deepEqual(merged.impactRiskObjects, []);
  assert.equal(merged.solarWindNow, null);
});

// spaceWeatherEnrichmentLabel is the ONLY place solarEvents/closeApproaches/
// radioBlackoutScale become text a user can read (see its doc comment for
// why). These pin the actual reachable content, not just that the fields
// survive `getStats()`.
test('an empty enrichment renders an empty label, not a placeholder', () => {
  assert.equal(spaceWeatherEnrichmentLabel(), '');
  assert.equal(spaceWeatherEnrichmentLabel({ solarEvents: [], closeApproaches: [], radioBlackoutScale: null }), '');
});

test('a "0" (no blackout) reading is a real observation but earns no status clause', () => {
  assert.equal(
    spaceWeatherEnrichmentLabel({ radioBlackoutScale: { scale: '0', text: 'none' } }),
    '',
  );
});

test('a nonzero radio-blackout scale renders as R<n> BLACKOUT', () => {
  assert.equal(
    spaceWeatherEnrichmentLabel({ radioBlackoutScale: { scale: '2', text: 'Moderate' } }),
    'R2 BLACKOUT',
  );
});

test('solar events render as a count, singular and plural', () => {
  assert.equal(
    spaceWeatherEnrichmentLabel({ solarEvents: [{ id: 'a' }] }),
    '1 SOLAR EVENT',
  );
  assert.equal(
    spaceWeatherEnrichmentLabel({ solarEvents: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    '3 SOLAR EVENTS',
  );
});

test('the closest approach renders in lunar distances, not raw kilometers', () => {
  const label = spaceWeatherEnrichmentLabel({
    closeApproaches: [
      { id: '1', name: '(2026 BB2)', missDistanceKm: 384_400 },
      { id: '2', name: 'FARTHER', missDistanceKm: 5_000_000 },
    ],
  });
  assert.equal(label, 'NEO (2026 BB2) · 1.0 LD');
});

test('all three clauses join in a fixed order and skip whatever has nothing to report', () => {
  const label = spaceWeatherEnrichmentLabel({
    radioBlackoutScale: { scale: '3', text: 'Strong' },
    solarEvents: [{ id: 'a' }, { id: 'b' }],
    closeApproaches: [{ id: '1', name: 'ROCK', missDistanceKm: 768_800 }],
  });
  assert.equal(label, 'R3 BLACKOUT · 2 SOLAR EVENTS · NEO ROCK · 2.0 LD');
});

test('a non-finite miss distance is skipped rather than rendering NEO undefined LD', () => {
  const label = spaceWeatherEnrichmentLabel({
    closeApproaches: [{ id: '1', name: 'BAD', missDistanceKm: NaN }],
  });
  assert.equal(label, '');
});
