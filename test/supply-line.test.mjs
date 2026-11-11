import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateSupplyLine } from '../lib/supply-line.ts';
import { FIRE_RESPONSE_CONFIG } from '../lib/fire-response.config.ts';

const routed = (meters, source = 'mapbox') => ({ straightLineM: meters * 0.7, route: { meters, source } });
const estimate = (input, overrides = {}) => estimateSupplyLine(input, { ...FIRE_RESPONSE_CONFIG, ...overrides });
const sectionsBySize = result => Object.fromEntries(result.hose.sections.map(({ lengthFt, count }) => [lengthFt, count]));

// BFP requirement: 50-ft hose only; one relay engine is added for every
// additional 150 ft (45.72 m) of supply line.
const WORKED_EXAMPLES = [
  ['nearby hydrant', routed(45), 45, 0, 3, 46],
  ['first relay engine', routed(46), 46, 1, 4, 61],
  ['typical lay', routed(320), 320, 6, 21, 320],
  ['long lay', routed(650), 650, 14, 43, 655],
  ['routing failed, 250 m straight-line', { straightLineM: 250, route: null }, 325, 7, 22, 335],
  ['fire at the hydrant', routed(0), 0, 0, 1, 15],
];

test('matches the BFP 50-ft hose and 150-ft relay rule', () => {
  for (const [name, input, hoseLengthM, relayEngines, fifties, laidLengthM] of WORKED_EXAMPLES) {
    const result = estimate(input);
    assert.equal(result.status, 'ready', name);
    assert.equal(result.hoseLengthM, hoseLengthM, name);
    assert.deepEqual(result.trucks, { engineAtFire: 1, pumperAtHydrant: 1, relayPumpers: relayEngines }, name);
    assert.equal(result.fireTrucks, 2 + relayEngines, name);
    assert.deepEqual(result.hose.sections, [{ lengthFt: 50, count: fifties }], name);
    assert.equal(result.hoseSections, fifties, name);
    assert.equal(result.hose.laidLengthM, laidLengthM, name);
    assert.equal(result.stageLengthM, 45.72, name);
    assert.equal(result.configVersion, FIRE_RESPONSE_CONFIG.version, name);
  }
});

test('adds one relay engine after each completed 150-ft stage', () => {
  for (const [meters, fireTrucks] of [[0, 2], [45, 2], [46, 3], [91, 3], [92, 4], [137, 4]]) {
    assert.equal(estimate(routed(meters)).fireTrucks, fireTrucks, `${meters} m`);
  }
});

test('the 50-ft hose used covers the line and stays within each engine capacity', () => {
  for (let meters = 0; meters <= 2500; meters++) {
    const result = estimate(routed(meters));
    const supplyEngines = result.fireTrucks - 1;
    const laidCm = result.hose.sections.reduce((sum, { lengthFt, count }) => sum + count * Math.round(lengthFt * 30.48), 0);
    assert.ok(laidCm >= meters * 100, `${meters} m is covered`);
    assert.ok(result.hoseSections >= 1, `${meters} m uses at least one section`);
    assert.ok(result.hose.sections[0].count <= 3 * supplyEngines, `${meters} m stays within the 50-ft hose stock`);
  }
});

test('reports where the hose length came from', () => {
  assert.deepEqual(estimate({ straightLineM: 240.4, route: { meters: 320, source: 'mapbox' } }).distance,
    { source: 'mapbox', straightLineM: 240 });
  assert.equal(estimate(routed(320, 'streets')).distance.source, 'streets');
  const fallback = estimate({ straightLineM: 250, route: null });
  assert.deepEqual(fallback.distance, { source: 'straight-line', straightLineM: 250 });
  assert.equal(fallback.hoseLengthM, 325);
  for (const meters of [NaN, -5, Infinity]) {
    assert.equal(estimate({ straightLineM: 250, route: { meters, source: 'mapbox' } }).distance.source, 'straight-line');
  }
});

test('trucks cover only the supply line; the off-street stretch to the fire is an attack line', () => {
  // 300 m to the street nearest the fire, then 60 m into the building.
  const result = estimate({ straightLineM: 280, route: { meters: 300, source: 'streets', attackLineM: 60.4 } });
  assert.equal(result.hoseLengthM, 300);
  assert.equal(result.attackLineM, 60);
  assert.equal(result.fireTrucks, estimate(routed(300)).fireTrucks);
  assert.equal(estimate(routed(300)).attackLineM, 0);
  assert.equal(estimate({ straightLineM: 250, route: null }).attackLineM, 0);
  for (const attackLineM of [NaN, -5, Infinity, undefined]) {
    assert.equal(estimate({ straightLineM: 250, route: { meters: 300, source: 'mapbox', attackLineM } }).attackLineM, 0);
  }
});

test('a pressure limit can shorten the 150-ft stage but cannot extend it', () => {
  const limited = estimate(routed(100), { maxPumpDistanceM: 30 });
  assert.equal(limited.stageLengthM, 30);
  assert.deepEqual(limited.trucks, { engineAtFire: 1, pumperAtHydrant: 1, relayPumpers: 3 });
  assert.equal(limited.fireTrucks, 5);
  assert.deepEqual(sectionsBySize(limited), { 50: 7 });
  assert.deepEqual(estimate(routed(100), { maxPumpDistanceM: 100 }), estimate(routed(100)));
});

test('the hose load is read from the config', () => {
  const result = estimate(routed(100), { hosePerTruck: [{ lengthFt: 50, count: 4 }], maxPumpDistanceM: null });
  assert.equal(result.stageLengthM, 60.96);
  assert.deepEqual(result.trucks, { engineAtFire: 1, pumperAtHydrant: 1, relayPumpers: 1 });
  assert.deepEqual(result.hose.sections, [{ lengthFt: 50, count: 7 }]);
});

test('missing or invalid config values report pending instead of a number', () => {
  assert.deepEqual(estimate(routed(100), { hosePerTruck: [] }), { status: 'pending', missing: ['hosePerTruck'] });
  assert.deepEqual(estimate(routed(100), { hosePerTruck: [{ lengthFt: 50, count: 0 }] }), { status: 'pending', missing: ['hosePerTruck'] });
  assert.deepEqual(estimate(routed(100), { maxPumpDistanceM: 0 }), { status: 'pending', missing: ['maxPumpDistanceM'] });
  assert.deepEqual(estimate({ straightLineM: 250, route: null }, { layoutFactor: null }), { status: 'pending', missing: ['layoutFactor'] });
  assert.equal(estimate(routed(100), { layoutFactor: null }).status, 'ready');
});
