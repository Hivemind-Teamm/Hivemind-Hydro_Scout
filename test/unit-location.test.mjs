import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stationIdForLocation } from '../lib/station-location-identity.ts';

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
