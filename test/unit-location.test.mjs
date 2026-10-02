import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stationIdForLocation, writeLoginLocation } from '../lib/unit-location.ts';

const fix = { coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } };
function setup(overrides = {}) {
  const writes = [];
  let requests = 0;
  const dependencies = {
    readProfile: async () => ({ accountType: 'station', role: 'authorized', stationId: 'station-1' }),
    isCurrentSession: () => true,
    geolocation: { getCurrentPosition(success, _failure, options) {
      requests++;
      assert.equal(options.maximumAge, 0);
      assert.equal(options.timeout, 10000);
      success(fix);
    } },
    writePosition: async (value) => writes.push(value),
    ...overrides,
  };
  return { dependencies, writes, requests: () => requests };
}

test('only explicitly marked station accounts with a valid stationId qualify', () => {
  for (const role of ['authorized', 'head']) {
    assert.equal(stationIdForLocation({ role, accountType: 'station', stationId: 'station-1' }), 'station-1');
  }
  for (const accountType of ['person', 'firefighter', null, undefined]) {
    assert.equal(stationIdForLocation({ role: 'authorized', accountType, stationId: 'station-1' }), null);
  }
  for (const stationId of [undefined, null, '', ' ', 'a/b', 'a'.repeat(129), 12]) {
    assert.equal(stationIdForLocation({ accountType: 'station', stationId }), null);
  }
});

test('writes the current coordinates and station identity', async () => {
  const { dependencies, writes } = setup();
  assert.equal(await writeLoginLocation('uid-1', dependencies), 'written');
  assert.deepEqual(writes, [{ stationId: 'station-1', updatedBy: 'uid-1', lat: 14.65, lng: 121.06, accuracy: 8 }]);
});

test('missing profiles, stationId, and nonstation roles never request GPS', async () => {
  for (const profile of [undefined, { accountType: 'station', station: 'Station One' }, { role: 'authorized', stationId: 'station-1' }]) {
    const ctx = setup({ readProfile: async () => profile });
    assert.equal(await writeLoginLocation('uid-1', ctx.dependencies), 'skipped');
    assert.equal(ctx.requests(), 0);
    assert.equal(ctx.writes.length, 0);
  }
});

test('denial, timeout, unavailable GPS, and invalid coordinates never write', async () => {
  const locations = [undefined,
    { getCurrentPosition: (_s, fail) => fail({ code: 1 }) },
    { getCurrentPosition: (_s, fail) => fail({ code: 3 }) },
    { getCurrentPosition: () => { throw new Error('unsupported'); } },
    ...[NaN, 91, -91].map(latitude => ({ getCurrentPosition: success => success({ coords: { ...fix.coords, latitude } }) })),
  ];
  for (const geolocation of locations) {
    const ctx = setup({ geolocation });
    assert.equal(await writeLoginLocation('uid-1', ctx.dependencies), 'unavailable');
    assert.equal(ctx.writes.length, 0);
  }
});

test('signout or session replacement during GPS capture cancels the write', async () => {
  let current = true;
  const ctx = setup({
    isCurrentSession: () => current,
    geolocation: { getCurrentPosition(success) { current = false; success(fix); } },
  });
  assert.equal(await writeLoginLocation('uid-1', ctx.dependencies), 'cancelled');
  assert.equal(ctx.writes.length, 0);
});

test('an unanswered permission prompt times out without writing', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  const ctx = setup({ geolocation: { getCurrentPosition: () => started() } });
  const result = writeLoginLocation('uid-1', ctx.dependencies);
  await requested;
  context.mock.timers.tick(15000);
  assert.equal(await result, 'unavailable');
  assert.equal(ctx.writes.length, 0);
});

test('profile and Firestore failures are contained', async () => {
  for (const key of ['readProfile', 'writePosition']) {
    const ctx = setup({ [key]: async () => { throw new Error('permission-denied'); } });
    assert.equal(await writeLoginLocation('uid-1', ctx.dependencies), 'failed');
  }
});
