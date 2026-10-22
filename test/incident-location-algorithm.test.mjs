import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const configSource = fs.readFileSync(
  new URL('../lib/incident-location-settings.mjs', import.meta.url),
  'utf8',
);

const algorithmSource = fs.readFileSync(
  new URL('../lib/incident-location-algorithm.ts', import.meta.url),
  'utf8',
);

const compiledConfig = ts.transpileModule(configSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const compiledAlgorithm = ts.transpileModule(algorithmSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function loadModule(source, requireFn = () => {
  throw new Error('Unexpected import');
}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: requireFn,
  });
  return module.exports;
}

const config = loadModule(compiledConfig);

const { decideIncidentLocationAction, distanceMeters } = loadModule(
  compiledAlgorithm,
  name => {
    if (name === './incident-location-config') return config;
    throw new Error(`Unexpected import: ${name}`);
  },
);

const incident = { id: 'fire-1', lat: 14.65, lng: 121.06 };
const fix = { lat: 14.65, lng: 121.06, accuracy: 10 };

const previous = (writtenAt, previousFix = fix) => ({
  incidentId: 'fire-1',
  fix: previousFix,
  writtenAt,
});

test('first accurate fix near active incident writes', () => {
  assert.equal(
    decideIncidentLocationAction(fix, [incident], null, 1000).action,
    'write',
  );
});

test('accuracy above 50 meters skips', () => {
  const result = decideIncidentLocationAction(
    { ...fix, accuracy: 50.01 }, [incident], null, 1000,
  );
  assert.equal(result.action, 'skip');
});

test('accuracy exactly 50 meters is accepted', () => {
  assert.equal(
    decideIncidentLocationAction({ ...fix, accuracy: 50 }, [incident], null, 1000).action,
    'write',
  );
});

test('no nearby incident requests deletion', () => {
  assert.equal(
    decideIncidentLocationAction(fix, [], null, 1000).action,
    'delete',
  );
});

test('incident more than 500 meters away requests deletion', () => {
  const farIncident = { ...incident, lat: 14.66 };
  assert.ok(distanceMeters(fix, { ...farIncident, accuracy: 0 }) > 500);
  assert.equal(
    decideIncidentLocationAction(fix, [farIncident], null, 1000).action,
    'delete',
  );
});

test('no movement before 30 seconds skips', () => {
  assert.equal(
    decideIncidentLocationAction(fix, [incident], previous(1000), 20000).action,
    'skip',
  );
});

test('movement above 10 meters before 5 seconds skips', () => {
  const movedFix = { ...fix, lat: fix.lat + 0.0001 };
  assert.ok(distanceMeters(fix, movedFix) >= 10);
  assert.equal(
    decideIncidentLocationAction(movedFix, [incident], previous(1000), 5999).action,
    'skip',
  );
});

test('movement above 10 meters after 5 seconds writes', () => {
  const movedFix = { ...fix, lat: fix.lat + 0.0001 };
  assert.equal(
    decideIncidentLocationAction(movedFix, [incident], previous(1000), 6000).action,
    'write',
  );
});

test('30-second heartbeat writes without movement', () => {
  assert.equal(
    decideIncidentLocationAction(fix, [incident], previous(1000), 31000).action,
    'write',
  );
});

test('invalid coordinates do not trigger writes or deletions', () => {
  assert.equal(
    decideIncidentLocationAction({ ...fix, lat: 999 }, [incident], null, 1000).action,
    'skip',
  );
});

test('incident ending requests deletion even with inaccurate GPS', () => {
  const inaccurateFix = { ...fix, accuracy: 120 };

  const result = decideIncidentLocationAction(
    inaccurateFix,
    [],
    previous(1000),
    2000,
  );

  assert.equal(result.action, 'delete');
});
