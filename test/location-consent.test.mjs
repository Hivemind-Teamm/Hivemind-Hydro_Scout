import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOCATION_NOTICE_VERSION, parseLocationConsent, consentKey } from '../lib/location-consent.ts';


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
