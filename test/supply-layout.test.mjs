import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutSupplyLine, MERGE_NEAR_FIRE_M, pointAlongPath, supplyStages } from '../lib/supply-layout.ts';
import { estimateSupplyLine } from '../lib/supply-line.ts';
import { FIRE_RESPONSE_CONFIG } from '../lib/fire-response.config.ts';

const estimate = meters => estimateSupplyLine({ straightLineM: meters, route: { meters, source: 'mapbox' } }, FIRE_RESPONSE_CONFIG);
const close = (actual, expected, name) => {
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-9 && Math.abs(actual[1] - expected[1]) < 1e-9,
    `${name}: ${actual} is not ${expected}`);
};

// A straight east-west line on the equator, so shares of distance are shares of longitude.
const line = [[0, 0], [0.01, 0]];

test('splits the hose into full stages and a shorter last one that add up to the hose length', () => {
  assert.deepEqual(supplyStages(estimate(0)), [0]);
  assert.deepEqual(supplyStages(estimate(320)), [320]);
  assert.deepEqual(supplyStages(estimate(458)), [457, 1]);
  assert.deepEqual(supplyStages(estimate(650)), [457, 193]);
  assert.deepEqual(supplyStages(estimate(1372)), [457, 457, 457, 1]);
  for (let meters = 0; meters <= 3000; meters++) {
    const result = estimate(meters);
    const stages = supplyStages(result);
    assert.equal(stages.length, result.fireTrucks - 1, `${meters} m: one stage per supply pumper`);
    assert.equal(stages.reduce((sum, m) => sum + m, 0), meters, `${meters} m: stages add up`);
    assert.ok(stages.every(m => m <= 458), `${meters} m: no stage is longer than one truck's hose`);
    assert.ok(meters === 0 || stages.every(m => m > 0), `${meters} m: no empty stage`);
  }
});

test('finds points along a path by distance, across bends', () => {
  const bent = [[0, 0], [0.003, 0], [0.003, 0.001]];
  close(pointAlongPath(bent, 0), [0, 0], 'start');
  close(pointAlongPath(bent, 0.5), [0.002, 0], 'halfway');
  close(pointAlongPath(bent, 0.875), [0.003, 0.0005], 'on the second leg');
  close(pointAlongPath(bent, 1), [0.003, 0.001], 'end');
  close(pointAlongPath(bent, 2), [0.003, 0.001], 'clamped past the end');
  close(pointAlongPath([[1, 1], [1, 1]], 0.5), [1, 1], 'zero-length path');
});

test('puts the pumper at the hydrant, a relay at the end of each full stage and the engine at the fire', () => {
  const { trucks, labelAt } = layoutSupplyLine(line, estimate(650));
  assert.deepEqual(trucks.map(t => t.role), ['pumper', 'relay', 'engine']);
  close(trucks[0].at, [0, 0], 'pumper');
  close(trucks[1].at, [0.01 * 457 / 650, 0], 'relay');
  close(trucks[2].at, [0.01, 0], 'engine');
  close(labelAt, [0.01 * 228.5 / 650, 0], 'label halfway along the first stage');
});

test('draws every counted truck exactly once', () => {
  for (let meters = 0; meters <= 3000; meters++) {
    const result = estimate(meters);
    const { trucks } = layoutSupplyLine(line, result);
    assert.equal(trucks.reduce((sum, t) => sum + t.count, 0), result.fireTrucks, `${meters} m`);
  }
});

test('a relay right by the fire is drawn with the engine instead of under the fire pin', () => {
  // 940 m: the second relay stands 26 m from the fire.
  const close = layoutSupplyLine(line, estimate(940));
  assert.deepEqual(close.trucks.map(t => [t.role, t.count]), [['pumper', 1], ['relay', 1], ['engine', 2]]);
  // 1000 m: 86 m away, far enough to draw on its own.
  const apart = layoutSupplyLine(line, estimate(1000));
  assert.deepEqual(apart.trucks.map(t => [t.role, t.count]), [['pumper', 1], ['relay', 1], ['relay', 1], ['engine', 1]]);
  assert.equal(MERGE_NEAR_FIRE_M, 50);
});

test('places no trucks while the counts are pending, and keeps the label mid-line', () => {
  const { trucks, labelAt } = layoutSupplyLine(line, null);
  assert.deepEqual(trucks, []);
  close(labelAt, [0.005, 0], 'midpoint');
  const atHydrant = layoutSupplyLine([[0, 0], [0, 0]], estimate(0));
  assert.deepEqual(atHydrant.trucks.map(t => t.role), ['pumper', 'engine']);
});
