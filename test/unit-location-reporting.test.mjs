import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startStationLocationReporting, UNIT_LOCATION_REPORT_INTERVAL_MS } from '../lib/unit-location.ts';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1000 });
  const writes = [];
  let active = true;
  let current = true;
  const dependencies = {
    readProfile: async () => ({ accountType: 'station', stationId: 'station-1' }),
    geolocation: { getCurrentPosition: success => success({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } }) },
    isActive: () => active,
    isCurrentSession: () => current,
    writePosition: async position => { writes.push(position); },
    ...overrides,
  };
  const reporting = startStationLocationReporting('uid', dependencies);
  t.after(() => reporting.stop());
  return { writes, reporting, setActive: value => { active = value; }, setCurrent: value => { current = value; } };
}

test('reports immediately and every three minutes, including an unchanged position', async t => {
  const { writes } = setup(t);
  await settle();
  assert.equal(writes.length, 1);
  t.mock.timers.tick(UNIT_LOCATION_REPORT_INTERVAL_MS);
  await settle();
  assert.equal(writes.length, 2);
});

test('hidden/offline sessions pause and resume produces a fresh report', async t => {
  const state = setup(t);
  await settle();
  state.setActive(false);
  t.mock.timers.tick(UNIT_LOCATION_REPORT_INTERVAL_MS * 6);
  await settle();
  assert.equal(state.writes.length, 1);
  state.setActive(true);
  await state.reporting.refresh();
  assert.equal(state.writes.length, 2);
});

test('overlapping requests coalesce and stopped sessions discard pending GPS', async t => {
  let complete;
  let gpsRequests = 0;
  const state = setup(t, { geolocation: { getCurrentPosition: success => { complete = success; gpsRequests++; } } });
  await settle();
  await state.reporting.refresh();
  assert.equal(gpsRequests, 1);
  state.reporting.stop();
  complete({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } });
  await settle();
  assert.equal(state.writes.length, 0);
});

test('session replacement and hiding during GPS prevent a position write', async t => {
  let complete;
  const state = setup(t, { geolocation: { getCurrentPosition: success => { complete = success; } } });
  await settle();
  state.setCurrent(false);
  complete({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } });
  await settle();
  assert.equal(state.writes.length, 0);
  state.setCurrent(true);
  t.mock.timers.tick(UNIT_LOCATION_REPORT_INTERVAL_MS);
  await settle();
  state.setActive(false);
  complete({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } });
  await settle();
  assert.equal(state.writes.length, 0);
});

test('individual accounts never request GPS and failed reports can retry', async t => {
  let requests = 0;
  let station = false;
  const state = setup(t, {
    readProfile: async () => station ? { accountType: 'station', stationId: 'station-1' } : {},
    geolocation: { getCurrentPosition: (success, failure) => {
      requests++;
      if (requests === 1) failure();
      else success({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } });
    } },
  });
  await settle();
  assert.equal(requests, 0);
  station = true;
  t.mock.timers.tick(UNIT_LOCATION_REPORT_INTERVAL_MS);
  await settle();
  assert.equal(state.writes.length, 0);
  t.mock.timers.tick(UNIT_LOCATION_REPORT_INTERVAL_MS);
  await settle();
  assert.equal(state.writes.length, 1);
});
