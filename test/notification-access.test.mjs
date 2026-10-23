import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationAccess, limitedOperationalNotification } from '../lib/notification-access.ts';

test('only approved authorized station members get operational access below management', () => {
  const profile = { accountType: 'person', role: 'authorized', stationId: 'one', stationMembershipStatus: 'approved' };
  assert.equal(notificationAccess(profile).operational, true);
  for (const change of [{ role: 'general' }, { stationMembershipStatus: 'pending' }, { stationMembershipStatus: 'rejected' }, { stationId: null }, { stationId: '../one' }]) {
    assert.equal(notificationAccess({ ...profile, ...change }).operational, false);
  }
  assert.equal(notificationAccess({ ...profile, stationAccessIds: ['one'] }).full, false);
  assert.equal(notificationAccess({ ...profile, role: 'head' }).full, true);
});

test('limited projection excludes administrative categories and all identities/free text', () => {
  for (const type of ['personal-station-assigned', 'membership-approved', 'membership-rejected', 'unknown']) {
    assert.equal(limitedOperationalNotification({ id: 'one', type, message: 'private' }), null);
  }
  const source = { id: 'event', type: 'response-ended', message: 'PRIVATE', uid: 'PRIVATE', displayName: 'PRIVATE', adminEmail: 'PRIVATE', targetUid: 'PRIVATE', targetName: 'PRIVATE', responseId: 'response',
    response: { id: 'response', uid: 'PRIVATE', displayName: 'PRIVATE', stationId: 'one', status: 'ended', endedByName: 'PRIVATE', endedByUid: 'PRIVATE', lastLocationAt: 'PRIVATE', endReason: 'PRIVATE' } };
  const projected = limitedOperationalNotification(source);
  assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
  assert.equal(projected.message, 'A station unit ended response.');
  assert.equal(projected.response.status, 'ended');
  assert.equal(projected.uid, undefined);
});
