import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const responseSource = readFileSync(
  new URL('../lib/fire-response.ts', import.meta.url),
  'utf8',
);

const source = ts.transpileModule(responseSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const exports = {};
const fireResponse = new Function(
  'exports',
  'require',
  `${source}; return exports;`,
)(exports, (name) => {
  if (name === './fire-response.config') {
    return {
      FIRE_RESPONSE_CONFIG: {
        hydrantSearchRadiusM: 1000,
        hydrantSearchExpansionM: 500,
      },
    };
  }

  if (name === './haversine') {
    return {
      haversineM: (lat1, lng1, lat2, lng2) =>
        Math.hypot(lat2 - lat1, lng2 - lng1) * 1000,
    };
  }

  throw new Error(`Unexpected dependency: ${name}`);
});

const hydrant = (id, distance, occupied = false, status = 'operational') => ({
  id,
  name: id,
  lat: distance / 1000,
  lng: 0,
  occupied,
  status,
});

test('unoccupied hydrants rank before occupied hydrants', () => {
  const hydrants = [
    hydrant('OCCUPIED-NEAR', 50, true),
    hydrant('AVAILABLE-FAR', 300, false),
    hydrant('AVAILABLE-NEAR', 100, false),
    hydrant('OCCUPIED-FAR', 400, true),
  ];

  const result = fireResponse.rankHydrantsNearFire(
    hydrants,
    { lat: 0, lng: 0 },
    1000,
  );

  assert.deepEqual(
    result.inRadius.map(c => c.hydrant.id),
    ['AVAILABLE-NEAR', 'AVAILABLE-FAR', 'OCCUPIED-NEAR', 'OCCUPIED-FAR'],
  );
});

test('automatic selection prefers an available operational hydrant', () => {
  const candidates = [
    { hydrant: hydrant('OCCUPIED', 50, true), distanceM: 50 },
    { hydrant: hydrant('AVAILABLE', 100, false), distanceM: 100 },
  ];

  assert.equal(
    fireResponse.pickSupplyHydrant(candidates, null)?.hydrant.id,
    'AVAILABLE',
  );
});

test('explicit selection can retain an occupied hydrant', () => {
  const candidates = [
    { hydrant: hydrant('AVAILABLE', 100, false), distanceM: 100 },
    { hydrant: hydrant('OCCUPIED', 50, true), distanceM: 50 },
  ];

  assert.equal(
    fireResponse.pickSupplyHydrant(candidates, 'OCCUPIED')?.hydrant.id,
    'OCCUPIED',
  );
});

test('automatic selection falls back when every hydrant is occupied', () => {
  const candidates = [
    { hydrant: hydrant('OCCUPIED-REDUCED', 50, true, 'reduced'), distanceM: 50 },
    { hydrant: hydrant('OCCUPIED-OPERATIONAL', 100, true), distanceM: 100 },
  ];

  assert.equal(
    fireResponse.pickSupplyHydrant(candidates, null)?.hydrant.id,
    'OCCUPIED-OPERATIONAL',
  );
});
