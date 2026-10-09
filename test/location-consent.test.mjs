import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOCATION_NOTICE_VERSION, parseLocationConsent, consentKey } from '../lib/location-consent.ts';
import { startStationLocationReporting } from '../lib/unit-location.ts';

const record = { version: LOCATION_NOTICE_VERSION, uid: 'uid', stationId: 'station-1', decision: 'granted', decidedAt: 1000 };
test('consent is bound to the account, station and current notice version', () => {
  assert.deepEqual(parseLocationConsent(JSON.stringify(record), 'uid', 'station-1'), record);
  assert.equal(parseLocationConsent(JSON.stringify(record), 'another-user', 'station-1'), null);
  assert.equal(parseLocationConsent(JSON.stringify(record), 'uid', 'station-2'), null);
  assert.notEqual(consentKey('uid', 'station-1'), consentKey('another-user', 'station-1'));
  for (const patch of [{ version: 'old' }, { decision: true }, { decidedAt: null }, { decidedAt: -1 }]) {
    assert.equal(parseLocationConsent(JSON.stringify({ ...record, ...patch }), 'uid', 'station-1'), null);
  }
  assert.equal(parseLocationConsent('broken', 'uid', 'station-1'), null);
  assert.equal(parseLocationConsent(null, 'uid', 'station-1'), null);
});

test('no consent prevents GPS; withdrawal cancels an in-flight report', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1000 });
  let allowed = false;
  let requests = 0;
  let writes = 0;
  let complete;
  const reporter = startStationLocationReporting('uid', {
    readProfile: async () => ({ accountType: 'station', stationId: 'station-1' }),
    isCurrentSession: () => allowed,
    isActive: () => true,
    geolocation: { getCurrentPosition: success => { requests++; complete = success; } },
    writePosition: async () => { writes++; },
  });
  t.after(() => reporter.stop());
  await reporter.refresh();
  assert.equal(requests, 0);
  allowed = true;
  const pending = reporter.refresh();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(requests, 1);
  allowed = false;
  complete({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } });
  await pending;
  assert.equal(writes, 0);
});

test('background sync eligibility does not depend on document focus or visibility', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1000 });
  let writes = 0;
  const reporter = startStationLocationReporting('uid', {
    readProfile: async () => ({ accountType: 'station', stationId: 'station-1' }),
    isCurrentSession: () => true,
    isActive: () => true,
    geolocation: { getCurrentPosition: success => success({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } }) },
    writePosition: async () => { writes++; },
  });
  t.after(() => reporter.stop());
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(writes, 1);
  t.mock.timers.tick(180_000);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(writes, 2);
});
