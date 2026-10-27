import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canStartStationResponse } from '../lib/response-access.ts';
import { fireIncidentDetails } from '../lib/fire-incident-details.ts';

const viewer = { accountType: 'person', role: 'general', stationId: 'one', stationMembershipStatus: 'approved' };
test('only approved Authorized and Head personal accounts can respond', () => {
  for (const role of ['general', 'admin', null]) assert.equal(canStartStationResponse({ ...viewer, role }), false);
  for (const role of ['authorized', 'head']) {
    assert.equal(canStartStationResponse({ ...viewer, role }), true);
    assert.equal(canStartStationResponse({ ...viewer, role, accountType: 'station' }), false);
    assert.equal(canStartStationResponse({ ...viewer, role, stationId: null }), false);
    assert.equal(canStartStationResponse({ ...viewer, role, stationMembershipStatus: 'pending' }), false);
  }
});
test('read-only incident details include only location, status, and pin time', () => {
  for (const status of ['active', 'cleared']) assert.deepEqual(fireIncidentDetails({ lat: 14.65, lng: 121.06, status,
    createdAt: { toMillis: () => 1000 }, uid: 'private', displayName: 'Private Name' }), { lat: 14.65, lng: 121.06, status, pinnedAt: 1000 });
  assert.equal(fireIncidentDetails({ lat: NaN, lng: 121, status: 'active' }), null);
  assert.equal(fireIncidentDetails({ lat: 14, lng: 181, status: 'active' }), null);
  assert.equal(fireIncidentDetails({ lat: 14, lng: 121, status: 'unknown' }), null);
});
