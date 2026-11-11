import assert from 'node:assert/strict';
import { test } from 'node:test';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { buildStreetGraph, JOIN_TOLERANCE_M, MAX_STRAIGHT_IN_M, shortestStreetPath, streetLinesFromTile } from '../lib/hose-network.ts';

// Streets on a small grid near the equator: 0.001° is about 111 m.
const street = (points, grade = 0) => ({ points, grade });
const walkway = points => ({ points, grade: 0, road: false });
const route = (lines, from, to) => shortestStreetPath(buildStreetGraph(lines), from, to);
const near = (actual, expected, toleranceM, name) =>
  assert.ok(Math.abs(actual - expected) <= toleranceM, `${name}: ${actual} is not within ${toleranceM} m of ${expected}`);

test('runs every street both ways: a hose ignores one-way rules', () => {
  // Drawn east to west, travelled west to east.
  const result = route([street([[0.002, 0], [0, 0]])], [0, 0], [0.002, 0]);
  near(result.distanceM, 222.4, 0.5, 'length');
  assert.deepEqual(result.coordinates, [[0, 0], [0.002, 0]]);
});

test('takes the shortest way through the network', () => {
  const lines = [
    street([[0, 0], [0.001, 0], [0.002, 0]]), // direct
    street([[0, 0], [0, 0.002], [0.002, 0.002], [0.002, 0]]), // around the block
  ];
  near(route(lines, [0, 0], [0.002, 0]).distanceM, 222.4, 0.5, 'direct');
  // With the direct street gone, it goes around.
  near(route([lines[1]], [0, 0], [0.002, 0]).distanceM, 667.2, 1, 'around');
});

test('starts and ends on the street nearest each point', () => {
  const result = route([street([[0, 0], [0.004, 0]])], [0.001, 0.0002], [0.003, -0.0001]);
  near(result.distanceM, 222.4, 0.5, 'between the two snapped points');
  near(result.coordinates[0][0], 0.001, 1e-9, 'start');
  near(result.coordinates[0][1], 0, 1e-9, 'start');
  near(result.coordinates.at(-1)[0], 0.003, 1e-9, 'end');
});

test('joins a side street that stops on or just short of another street', () => {
  const main = street([[0, 0], [0.004, 0]]);
  // Ends 1 m short of the main street, with no shared point.
  const side = street([[0.002, 0.002], [0.002, 0.000009]]);
  const result = route([main, side], [0.002, 0.002], [0.004, 0]);
  near(result.distanceM, 222.4 + 222.4, 2, 'down the side street, then along');
  // Beyond the tolerance it stays apart: the snap to the main street has no path.
  const far = street([[0.002, 0.002], [0.002, (JOIN_TOLERANCE_M + 1) / 111320]]);
  assert.equal(route([main, far], [0.002, 0.002], [0.004, 0]), null);
});

test('joins ground streets that cross, but not a road and the bridge over it', () => {
  const eastWest = street([[0, 0.001], [0.002, 0.001]]);
  const northSouth = street([[0.001, 0], [0.001, 0.002]]);
  near(route([eastWest, northSouth], [0, 0.001], [0.001, 0]).distanceM, 222.4, 1, 'turn at the crossing');
  const bridge = street([[0.001, 0], [0.001, 0.002]], 1);
  assert.equal(route([eastWest, bridge], [0, 0.001], [0.001, 0]), null);
});

test('returns null when there is no network or no connection', () => {
  assert.equal(route([], [0, 0], [0.001, 0]), null);
  const islands = [street([[0, 0], [0.001, 0]]), street([[0.003, 0], [0.004, 0]])];
  assert.equal(route(islands, [0, 0], [0.004, 0]), null);
});

test('keeps every truck on the road: the engine parks where the road ends and the attack line goes on', () => {
  const road = street([[0, 0], [0.003, 0]]);
  // A driveway or footpath 111 m into a lot, to a fire inside a building.
  const drive = walkway([[0.003, 0], [0.003, 0.001]]);
  const result = route([road, drive], [0, 0], [0.003, 0.001]);
  near(result.distanceM, 333.6, 0.5, 'supply line on the road only');
  assert.deepEqual(result.coordinates.at(-1), [0.003, 0]);
  near(result.attack.distanceM, 111.2, 0.5, 'attack line up the driveway');
  assert.deepEqual(result.attack.coordinates, [[0.003, 0], [0.003, 0.001]]);
  // A fire on the road has no attack line.
  assert.equal(route([road, drive], [0, 0], [0.002, 0]).attack, undefined);
});

test('never drives a truck down a walkway shortcut, but takes a short one on foot rather than a long detour', () => {
  // The road goes around the block; a walkway cuts straight across it.
  const around = street([[0, 0], [0, 0.002], [0.002, 0.002], [0.002, 0]]);
  const across = walkway([[0, 0], [0.002, 0]]);
  const result = route([around, across], [0, 0], [0.002, 0]);
  // 667 m by road beats 222 m of hand-laid hose, which counts ten times over.
  near(result.distanceM, 667.2, 1, 'around by road');
  assert.equal(result.attack, undefined);
  // A 20 m walkway beats a 450 m detour.
  const loop = street([[0, 0], [0, 0.002], [0.00218, 0.002], [0.00218, 0]]);
  const shortcut = walkway([[0.002, 0], [0.00218, 0]]);
  const short = route([street([[0, 0], [0.002, 0]]), loop, shortcut], [0, 0], [0.00218, 0]);
  near(short.distanceM, 222.4, 0.5, 'drives to the shortcut');
  near(short.attack.distanceM, 20, 0.5, 'walks the rest');
});

test('parks on a reachable road and runs straight in when no mapped way reaches the fire', () => {
  const road = street([[0, 0], [0.002, 0]]);
  // A road island right by the fire, joined to the rest only by a walkway.
  const island = street([[0.004, 0.0003], [0.005, 0.0003]]);
  const link = walkway([[0.002, 0], [0.004, 0.0003]]);
  const fire = [0.0045, 0.0006];
  const result = route([road, island, link], [0, 0], fire);
  // The island's road point is 33 m from the fire but no truck can reach it.
  assert.ok(result.coordinates.every(([lng]) => lng <= 0.002));
  assert.equal(result.attack.coordinates.at(-1)[0], 0.0045);
  // With no walkway and the reachable road farther than a straight run in,
  // there is no connection (the island stays out of reach).
  assert.ok(MAX_STRAIGHT_IN_M < 250);
  assert.equal(route([road, island], [0, 0], fire), null);
});

test('reads hose-usable streets from a vector tile and joins them across tile edges', () => {
  // Two neighbouring zoom-14 tiles, with one street crossing the edge between them.
  const x = 13701, y = 7518, z = 14, extent = 4096;
  const feature = (geometry, tags) => ({ type: 2, geometry: [geometry], tags });
  const tile = features => new VectorTile(new Pbf(fromGeojsonVt({ transportation: { features } }, { version: 2, extent })));
  const left = tile([
    feature([[3000, 2000], [4096 + 64, 2000]], { class: 'minor' }), // runs into the buffer
    feature([[3000, 2100], [3500, 2100]], { class: 'motorway' }),
    feature([[3000, 2200], [3500, 2200]], { class: 'path', indoor: 1 }),
    feature([[3000, 2300], [3500, 2300]], { class: 'rail' }),
    feature([[3000, 2400], [3500, 2400]], { class: 'minor', brunnel: 'bridge' }),
  ]);
  const right = tile([feature([[-64, 2000], [1000, 2000]], { class: 'minor' })]);
  const lines = [...streetLinesFromTile(left, x, y, z), ...streetLinesFromTile(right, x + 1, y, z)];
  assert.deepEqual(lines.map(l => l.grade), [0, 1, 0]);
  assert.deepEqual(lines.map(l => l.road), [true, true, true]);

  const graph = buildStreetGraph(lines);
  const [westEnd] = lines[0].points;
  const eastEnd = lines[2].points.at(-1);
  const result = shortestStreetPath(graph, westEnd, eastEnd);
  // 2096 tile units of longitude (about 0.58 m each), on the code's 6371 km sphere.
  near(result.distanceM, 2096 * 2 * Math.PI * 6371000 * Math.cos(westEnd[1] * Math.PI / 180) / (extent * 2 ** z), 0.5, 'one street across both tiles');
});
