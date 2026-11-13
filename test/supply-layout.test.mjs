import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutSupplyLine, MERGE_NEAR_FIRE_M, pointAlongPath, supplyStages, TRUCK_ROLE_LABELS } from '../lib/supply-layout.ts';
import { estimateSupplyLine } from '../lib/supply-line.ts';
import { FIRE_RESPONSE_CONFIG } from '../lib/fire-response.config.ts';

const estimate = meters => estimateSupplyLine({ straightLineM: meters, route: { meters, source: 'mapbox' } }, FIRE_RESPONSE_CONFIG);
const close = (actual, expected, name) => {
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-9 && Math.abs(actual[1] - expected[1]) < 1e-9,
    `${name}: ${actual} is not ${expected}`);
};

const line = [[0, 0], [0.01, 0]];

test('splits the hose into BFP 150-ft stages that add up to the full line', () => {
  assert.deepEqual(supplyStages(estimate(0)), [0]);
  assert.deepEqual(supplyStages(estimate(45)), [45]);
  assert.deepEqual(supplyStages(estimate(46)), [45, 1]);
  assert.deepEqual(supplyStages(estimate(100)), [45, 46, 9]);
  for (let meters = 0; meters <= 3000; meters++) {
    const result = estimate(meters);
    const stages = supplyStages(result);
    assert.equal(stages.length, result.fireTrucks - 1, `${meters} m: one stage per supply engine`);
    assert.equal(stages.reduce((sum, m) => sum + m, 0), meters, `${meters} m: stages add up`);
    assert.ok(stages.every(m => m <= 46), `${meters} m: no stage exceeds 150 ft`);
    assert.ok(meters === 0 || stages.every(m => m > 0), `${meters} m: no empty stage`);
  }
});

test('finds points along a path by distance, across bends', () => {
  const bent = [[0, 0], [0.003, 0], [0.003, 0.001]];
  close(pointAlongPath(bent, 0), [0, 0], 'start');
  close(pointAlongPath(bent, 0.5), [0.002, 0], 'halfway');
  close(pointAlongPath(bent, 0.875), [0.003, 0.0005], 'on the second leg');
  close(pointAlongPath(bent, 1), [0.003, 0.001], 'end');
});

test('puts one relay engine at every completed 150-ft stage', () => {
  const { trucks, labelAt } = layoutSupplyLine(line, estimate(100));
  assert.deepEqual(trucks.map(t => t.role), ['pumper', 'relay', 'engine']);
  close(trucks[0].at, [0, 0], 'pumper');
  close(trucks[1].at, [0.01 * 45 / 100, 0], 'relay');
  close(trucks[2].at, [0.01, 0], 'engine');
  close(labelAt, [0.01 * 22.5 / 100, 0], 'label halfway along the first stage');
});

test('draws every counted truck exactly once', () => {
  for (let meters = 0; meters <= 3000; meters++) {
    const result = estimate(meters);
    const { trucks } = layoutSupplyLine(line, result);
    assert.equal(trucks.reduce((sum, t) => sum + t.count, 0), result.fireTrucks, `${meters} m`);
  }
});

test('merges only a relay within 10 m of the fire into the engine marker', () => {
  const closeToFire = layoutSupplyLine(line, estimate(46));
  assert.deepEqual(closeToFire.trucks.map(t => [t.role, t.count]), [['pumper', 1], ['engine', 2]]);
  const apart = layoutSupplyLine(line, estimate(55));
  assert.deepEqual(apart.trucks.map(t => [t.role, t.count]), [['pumper', 1], ['relay', 1], ['engine', 1]]);
  assert.equal(MERGE_NEAR_FIRE_M, 10);
});

test('places no trucks while the counts are pending', () => {
  assert.deepEqual(layoutSupplyLine(line, null).trucks, []);
  assert.deepEqual(layoutSupplyLine([[0, 0], [0, 0]], estimate(0)).trucks.map(t => t.role), ['pumper', 'engine']);
});

test('the engine beside the hydrant is named as the relay/spotter', () => {
  assert.deepEqual(TRUCK_ROLE_LABELS, {
    pumper: 'Relay/spotter at hydrant',
    relay: 'Relay engine',
    engine: 'Engine at the fire',
  });
});
