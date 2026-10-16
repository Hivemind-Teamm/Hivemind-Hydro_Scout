import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateSupplyLine } from '../lib/supply-line.ts';
import { FIRE_RESPONSE_CONFIG } from '../lib/fire-response.config.ts';

const routed = (meters, source = 'mapbox') => ({ straightLineM: meters * 0.7, route: { meters, source } });
const estimate = (input, overrides = {}) => estimateSupplyLine(input, { ...FIRE_RESPONSE_CONFIG, ...overrides });
const sectionsBySize = result => Object.fromEntries(result.hose.sections.map(({ lengthFt, count }) => [lengthFt, count]));

// docs/formula-spec.md, "Worked examples". Columns: case, input, hose length,
// relay pumpers, 100 ft sections, 50 ft sections, laid length.
const WORKED_EXAMPLES = [
  ['nearby hydrant', routed(100), 100, 0, 3, 1, 107],
  ['typical lay', routed(320), 320, 0, 10, 1, 320],
  ['just inside one stage', routed(457), 457, 0, 10, 10, 457],
  ['just over one stage', routed(458), 458, 1, 15, 1, 472],
  ['long lay', routed(650), 650, 1, 20, 3, 655],
  ['routing failed, 250 m straight-line', { straightLineM: 250, route: null }, 325, 0, 10, 2, 335],
  ['fire at the hydrant', routed(0), 0, 0, 0, 1, 15],
];

test('matches every worked example in the formula spec', () => {
  for (const [name, input, hoseLengthM, relayPumpers, hundreds, fifties, laidLengthM] of WORKED_EXAMPLES) {
    const result = estimate(input);
    assert.equal(result.status, 'ready', name);
    assert.equal(result.hoseLengthM, hoseLengthM, name);
    assert.deepEqual(result.trucks, { engineAtFire: 1, pumperAtHydrant: 1, relayPumpers }, name);
    assert.equal(result.fireTrucks, 2 + relayPumpers, name);
    assert.deepEqual(result.hose.sections, [{ lengthFt: 100, count: hundreds }, { lengthFt: 50, count: fifties }], name);
    assert.equal(result.hoseSections, hundreds + fifties, name);
    assert.equal(result.hose.laidLengthM, laidLengthM, name);
    assert.equal(result.stageLengthM, 457.2, name);
    assert.equal(result.configVersion, FIRE_RESPONSE_CONFIG.version, name);
  }
});

test('never reports fewer than two trucks and adds one relay pumper per extra stage', () => {
  for (const [meters, fireTrucks] of [[0, 2], [1, 2], [457, 2], [458, 3], [914, 3], [915, 4], [1372, 5]]) {
    assert.equal(estimate(routed(meters)).fireTrucks, fireTrucks, `${meters} m`);
  }
});

test('the hose used always covers the line and never exceeds what the supply pumpers carry', () => {
  for (let meters = 0; meters <= 2500; meters++) {
    const result = estimate(routed(meters));
    const supplyPumpers = result.fireTrucks - 1;
    const laidCm = result.hose.sections.reduce((sum, { lengthFt, count }) => sum + count * Math.round(lengthFt * 30.48), 0);
    assert.ok(laidCm >= meters * 100, `${meters} m is covered`);
    assert.ok(result.hoseSections >= 1, `${meters} m uses at least one section`);
    for (const { lengthFt, count } of result.hose.sections) {
      assert.ok(count <= 10 * supplyPumpers, `${meters} m stays within the ${lengthFt} ft stock`);
    }
  }
});

test('reports where the hose length came from', () => {
  assert.deepEqual(estimate({ straightLineM: 240.4, route: { meters: 320, source: 'mapbox' } }).distance,
    { source: 'mapbox', straightLineM: 240 });
  assert.equal(estimate(routed(320, 'osrm')).distance.source, 'osrm');
  // No route yet, or routing failed: the straight-line estimate stands in.
  const fallback = estimate({ straightLineM: 250, route: null });
  assert.deepEqual(fallback.distance, { source: 'straight-line', straightLineM: 250 });
  assert.equal(fallback.hoseLengthM, 325);
  for (const meters of [NaN, -5, Infinity]) {
    assert.equal(estimate({ straightLineM: 250, route: { meters, source: 'mapbox' } }).distance.source, 'straight-line');
  }
});

test('a pressure limit from the config shortens the stage', () => {
  const limited = estimate(routed(650), { maxPumpDistanceM: 300 });
  assert.equal(limited.stageLengthM, 300);
  assert.deepEqual(limited.trucks, { engineAtFire: 1, pumperAtHydrant: 1, relayPumpers: 2 });
  assert.equal(limited.fireTrucks, 4);
  assert.deepEqual(sectionsBySize(limited), { 100: 21, 50: 1 });
  // A limit beyond the hose carried changes nothing.
  assert.deepEqual(estimate(routed(650), { maxPumpDistanceM: 1000 }), estimate(routed(650)));
});

test('the hose load is read from the config', () => {
  const result = estimate(routed(100), { hosePerTruck: [{ lengthFt: 50, count: 4 }, { lengthFt: 100, count: 1 }] });
  assert.equal(result.stageLengthM, 91.4);
  assert.deepEqual(result.trucks, { engineAtFire: 1, pumperAtHydrant: 1, relayPumpers: 1 });
  assert.deepEqual(result.hose.sections, [{ lengthFt: 100, count: 2 }, { lengthFt: 50, count: 3 }]);
});

test('missing or invalid config values report pending instead of a number', () => {
  assert.deepEqual(estimate(routed(100), { hosePerTruck: [] }), { status: 'pending', missing: ['hosePerTruck'] });
  assert.deepEqual(estimate(routed(100), { hosePerTruck: [{ lengthFt: 50, count: 0 }] }), { status: 'pending', missing: ['hosePerTruck'] });
  assert.deepEqual(estimate(routed(100), { maxPumpDistanceM: 0 }), { status: 'pending', missing: ['maxPumpDistanceM'] });
  assert.deepEqual(estimate({ straightLineM: 250, route: null }, { layoutFactor: null }), { status: 'pending', missing: ['layoutFactor'] });
  // The layout factor only matters for the straight-line fallback.
  assert.equal(estimate(routed(100), { layoutFactor: null }).status, 'ready');
  // The pressure limit is optional.
  assert.equal(estimate(routed(100), { maxPumpDistanceM: null }).status, 'ready');
});
