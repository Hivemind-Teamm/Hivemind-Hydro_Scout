import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditStationHydrant } from '../lib/hydrant-edit-access.ts';

const viewer = { role: 'authorized', accountType: 'person', stationId: 'one', stationMembershipStatus: 'approved' };
const station = { id: 'one', active: true, aorBarangays: ['Barangay One'] };
test('authorized members, heads, and station accounts edit only their station AoR', () => {
  for (const patch of [{}, { role: 'head' }, { accountType: 'station', role: 'head', stationMembershipStatus: 'none' }]) {
    assert.equal(canEditStationHydrant({ ...viewer, ...patch }, station, 'Barangay One'), true);
    assert.equal(canEditStationHydrant({ ...viewer, ...patch }, station, 'Barangay Two'), false);
  }
});
test('missing/inactive assignments, unapproved members and general users fail closed', () => {
  for (const patch of [{ role: 'general' }, { stationId: null }, { stationMembershipStatus: 'pending' }, { stationMembershipStatus: 'rejected' }]) {
    assert.equal(canEditStationHydrant({ ...viewer, ...patch }, station, 'Barangay One'), false);
  }
  assert.equal(canEditStationHydrant(viewer, { ...station, active: false }, 'Barangay One'), false);
  assert.equal(canEditStationHydrant(viewer, undefined, 'Barangay One'), false);
  assert.equal(canEditStationHydrant(viewer, station, undefined), false);
});
test('personal admins retain cross-station access', () => {
  assert.equal(canEditStationHydrant({ ...viewer, role: 'admin' }, undefined, undefined), true);
  assert.equal(canEditStationHydrant({ ...viewer, accountType: 'station', role: 'admin' }, station, 'Barangay Two'), false);
});
