import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
  new URL('../app/src/components/HydroScoutDashboard.tsx', import.meta.url),
  'utf8',
);

const start = source.indexOf('const handleViewFireNotification =');
const end = source.indexOf('const handleToggleReports', start);

assert.ok(start !== -1 && end > start, 'notification handler must exist');

const handlerSource = source.slice(start, end);

const compiled = ts.transpileModule(handlerSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  },
}).outputText;

function createScenario({ selectedFireId, pins }) {
  let supplyChoice = 'HYD-001';
  let currentFireId = selectedFireId;
  const resetCalls = [];
  const mapMoves = [];

  const sandbox = {
    selectedFireId,
    sharedFires: { pins },
    useCallback: fn => fn,

    setSelectedHydrant: () => {},
    setShowFullDetails: () => {},
    setShowEdit: () => {},
    setShowReport: () => {},
    setShowReports: () => {},
    setNearestPanelOpen: () => {},
    setNearestHydrant: () => {},
    setFirePanelMinimized: () => {},

    setFireSupplyChoice: value => {
      supplyChoice = value;
      resetCalls.push(value);
    },

    setSelectedFireId: value => {
      currentFireId = value;
    },

    controllerRef: {
      current: {
        flyTo: (...args) => mapMoves.push(args),
      },
    },
  };

  const handler = runInNewContext(
    `${compiled}\nhandleViewFireNotification`,
    sandbox,
  );

  return {
    open: (lat, lng) => handler(lat, lng),
    get supplyChoice() { return supplyChoice; },
    get currentFireId() { return currentFireId; },
    resetCalls,
    mapMoves,
  };
}

const pins = [
  { id: 'FIRE-A', lat: 14.60, lng: 121.00 },
  { id: 'FIRE-B', lat: 14.61, lng: 121.01 },
];

test('switching to a different fire clears the previous supply', () => {
  const scenario = createScenario({
    selectedFireId: 'FIRE-A',
    pins,
  });

  scenario.open(14.61, 121.01);

  assert.equal(scenario.currentFireId, 'FIRE-B');
  assert.equal(scenario.supplyChoice, null);
  assert.deepEqual(scenario.resetCalls, [null]);
  assert.deepEqual(scenario.mapMoves, [[14.61, 121.01, 17]]);
});

test('reopening the same fire preserves its supply', () => {
  const scenario = createScenario({
    selectedFireId: 'FIRE-A',
    pins,
  });

  scenario.open(14.60, 121.00);

  assert.equal(scenario.currentFireId, 'FIRE-A');
  assert.equal(scenario.supplyChoice, 'HYD-001');
  assert.deepEqual(scenario.resetCalls, []);
});

test('notification for a missing fire clears the previous supply', () => {
  const scenario = createScenario({
    selectedFireId: 'FIRE-A',
    pins,
  });

  scenario.open(14.70, 121.10);

  assert.equal(scenario.currentFireId, null);
  assert.equal(scenario.supplyChoice, null);
  assert.deepEqual(scenario.resetCalls, [null]);
});
