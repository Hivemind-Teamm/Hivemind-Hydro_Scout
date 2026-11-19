import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp } from 'firebase/firestore';
import assert from 'node:assert/strict';

const env = await initializeTestEnvironment({
  projectId: 'demo-station-responses',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('users/admin').set({
      uid: 'admin', role: 'admin', accountType: 'person', displayName: 'Admin', activeResponseId: null,
    });
    await db.doc('stations/DILIMAN-01').set({ name: 'Diliman Fire Station', active: true, createdAt: serverTimestamp() });
    await db.doc('firePins/abcdefghijklmnopqrst').set({ lat: 14.65, lng: 121.06, stationId: 'DILIMAN-01', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await db.doc('users/head-1').set({
      uid: 'head-1', role: 'head', accountType: 'person', stationId: 'DILIMAN-01',
      stationMembershipStatus: 'approved', displayName: 'Station Head',
    });
    await db.doc('users/member-1').set({
      role: 'general', accountType: 'person', stationId: 'DILIMAN-01',
      stationMembershipStatus: 'approved', displayName: 'Responder One', activeResponseId: null,
    });
    await db.doc('users/member-2').set({
      role: 'general', accountType: 'person', stationId: 'DILIMAN-02',
      stationMembershipStatus: 'approved', displayName: 'Other Responder',
    });
    await db.doc('users/assignment-target').set({
      role: 'general', accountType: 'person', stationId: 'DILIMAN-02',
      stationMembershipStatus: 'approved', displayName: 'Account Target',
    });
  });

  // STEP 48B.5D.14E: SERVER CONSENT FIXTURES
  // Test-only setup. Bypass rules to seed server-owned governance
  // and already-approved, current consent for authorized responders.
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const governanceRef = db.doc('appSettings/locationPrivacy');

    await governanceRef.set({
      controller: 'HydroScout Test Controller',
      contact: 'privacy@example.test',
      updatedAt: serverTimestamp(),
      updatedBy: 'admin',
    });

    const governanceSnapshot = await governanceRef.get();
    assert.equal(governanceSnapshot.exists, true);

    const governanceUpdatedAt = governanceSnapshot.data().updatedAt;
    assert.ok(governanceUpdatedAt);

    const noticeVersion = '2026-10-23-v5';

    for (const [uid, stationId] of [
      ['member-1', 'DILIMAN-01'],
      ['admin', 'SYSTEM_ADMIN'],
    ]) {
      await db.doc(
        `users/${uid}/locationConsents/${stationId}`,
      ).set({
        uid,
        stationId,
        decision: 'granted',
        noticeVersion,
        governanceUpdatedAt,
        updatedAt: serverTimestamp(),
      });
    }
  });
  const dbFor = uid => env.authenticatedContext(uid).firestore();
  const newMemberDb = dbFor('new-member');
  const headDb = dbFor('head-1');
  const adminDb = env.authenticatedContext('admin', { email: 'admin@example.test' }).firestore();
  const signup = newMemberDb.batch();
  signup.set(newMemberDb.doc('users/new-member'), {
    email: 'new-member@example.test',
    displayName: 'New Member',
    role: 'general',
    accountType: 'person',
    stationMembershipStatus: 'pending',
    requestedStationId: 'DILIMAN-01',
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  });
  signup.set(newMemberDb.doc('stationJoinRequests/new-member'), {
    uid: 'new-member',
    displayName: 'New Member',
    email: 'new-member@example.test',
    stationId: 'DILIMAN-01',
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  await assertSucceeds(signup.commit());
  await assertFails(adminDb.doc('stationJoinRequests/new-member').get());
  const pendingRequest = await headDb.doc('stationJoinRequests/new-member').get();
  assert.equal(pendingRequest.data().status, 'pending');
  await assertFails(newMemberDb.doc('stations/DILIMAN-01/notifications/join-new-member').set({
    type: 'station-join-request',
    uid: 'new-member',
    displayName: 'New Member',
    message: 'New Member requested to join DILIMAN-01.',
    createdAt: serverTimestamp(),
  }));

  const pendingRequests = await headDb.collection('stationJoinRequests')
    .where('stationId', '==', 'DILIMAN-01').where('status', '==', 'pending').get();
  assert.equal(pendingRequests.size, 1);
  const approval = headDb.batch();
  approval.update(headDb.doc('stationJoinRequests/new-member'), {
    status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'head-1',
  });
  approval.update(headDb.doc('users/new-member'), {
    stationMembershipStatus: 'approved',
    stationId: 'DILIMAN-01',
    station: 'Diliman Fire Station',
    requestedStationId: null,
  });
  approval.set(headDb.doc('stations/DILIMAN-01/notifications/join-review-new-member-approved'), {
    type: 'membership-approved',
    uid: 'new-member',
    displayName: 'New Member',
    message: 'New Member’s station membership request was approved.',
    createdAt: serverTimestamp(),
  });
  await assertSucceeds(approval.commit());
  const approvedProfile = await newMemberDb.doc('users/new-member').get();
  assert.equal(approvedProfile.data().stationMembershipStatus, 'approved');

  const assignmentId = 'account-assignment-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const assignment = adminDb.batch();
  assignment.update(adminDb.doc('users/assignment-target'), {
    stationId: 'DILIMAN-01',
    station: 'Diliman Fire Station',
    stationMembershipStatus: 'approved',
  });
  assignment.set(adminDb.doc(`stations/DILIMAN-01/notifications/${assignmentId}`), {
    type: 'personal-station-assigned',
    uid: 'admin',
    displayName: 'Admin',
    adminEmail: 'admin@example.test',
    targetUid: 'assignment-target',
    targetName: 'Account Target',
    message: 'Admin account: admin@example.test changed "Account Target" station to DILIMAN-01.',
    createdAt: serverTimestamp(),
  });
  await assertSucceeds(assignment.commit());
  const assignmentNotice = await headDb.doc(`stations/DILIMAN-01/notifications/${assignmentId}`).get();
  assert.equal(assignmentNotice.data().message, 'Admin account: admin@example.test changed "Account Target" station to DILIMAN-01.');
  await assertFails(dbFor('member-2').doc(`stations/DILIMAN-01/notifications/${assignmentId}`).get());

  const forgedAssignment = adminDb.batch();
  forgedAssignment.set(adminDb.doc('stations/DILIMAN-01/notifications/account-assignment-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), {
    type: 'personal-station-assigned',
    uid: 'admin',
    displayName: 'Admin',
    adminEmail: 'spoofed@example.test',
    targetUid: 'assignment-target',
    targetName: 'Account Target',
    message: 'Admin account: spoofed@example.test changed "Account Target" station to DILIMAN-01.',
    createdAt: serverTimestamp(),
  });
  await assertFails(forgedAssignment.commit());

  const responseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const responsePath = `stationResponses/${responseId}`;
  const locationPath = `stations/DILIMAN-01/unitLocations/${responseId}`;
  const noticePath = `stations/DILIMAN-01/notifications/${responseId}_start`;

  const memberDb = dbFor('member-1');
  // The fire pin is at 14.65, 121.06. Offsets due north, in metres.
  const METRES_PER_DEGREE_LAT = 111_194.9;
  const northOfFire = metres => ({ lat: 14.65 + metres / METRES_PER_DEGREE_LAT, lng: 121.06 });
  const marker = (position, overrides = {}) => ({
    responseId,
    stationId: 'DILIMAN-01',
    stationName: 'Diliman Fire Station',
    public: true,
    ...position,
    accuracy: 8,
    updatedAt: serverTimestamp(),
    ...overrides,
  });
  const buildStart = (incident = {}, location = { lat: 14.65, lng: 121.06 }) => {
  const start = memberDb.batch();
  start.update(memberDb.doc('users/member-1'), { activeResponseId: responseId });
  start.set(memberDb.doc(responsePath), {
    firePinId: 'abcdefghijklmnopqrst', incidentLat: 14.65, incidentLng: 121.06, ...incident,
    responseId,
    uid: 'member-1',
    displayName: 'Responder One',
    stationId: 'DILIMAN-01',
    stationName: 'Diliman Fire Station',
    status: 'active',
    startedAt: serverTimestamp(),
    endedAt: null,
    lastLocationAt: serverTimestamp(),
  });
  if (location) start.set(memberDb.doc(locationPath), marker(location));
  start.set(memberDb.doc(noticePath), {
    type: 'response-started',
    uid: 'member-1',
    displayName: 'Responder One',
    responseId,
    message: 'Responder One started responding.',
    createdAt: serverTimestamp(),
  });
  return start;
  };
  await assertFails(buildStart({ firePinId: 'missingincidentpin00' }).commit());
  await assertFails(buildStart({ incidentLat: 10 }).commit());
  await env.withSecurityRulesDisabled(context => context.firestore().doc('firePins/abcdefghijklmnopqrst').update({ status: 'cleared' }));
  await assertFails(buildStart().commit());
  await env.withSecurityRulesDisabled(context => context.firestore().doc('firePins/abcdefghijklmnopqrst').update({ status: 'active' }));

  // Responders are shown to others only within 1 km of their fire.
  // A start from outside 1 km may not publish a marker...
  await assertFails(buildStart({}, northOfFire(1_500)).commit());
  // ...but the response itself starts without one.
  await assertSucceeds(buildStart({}, null).commit());
  let startedWithoutMarker;
  await env.withSecurityRulesDisabled(async ctx => {
    startedWithoutMarker = await ctx.firestore().doc(locationPath).get();
  });
  assert.equal(startedWithoutMarker.exists, false);
  const noMarkers = await assertSucceeds(dbFor('member-2').collectionGroup('unitLocations').where('public', '==', true).get());
  assert.equal(noMarkers.size, 0);
  // Publishing is refused outside the radius (10 m model allowance) and
  // accepted on entering it.
  await assertFails(memberDb.doc(locationPath).set(marker(northOfFire(1_500))));
  await assertFails(memberDb.doc(locationPath).set(marker(northOfFire(1_020))));
  await assertSucceeds(memberDb.doc(locationPath).set(marker(northOfFire(990))));
  // The check follows the live pin: after the fire is moved 2 km away, the
  // same spot is outside the radius.
  await env.withSecurityRulesDisabled(context => context.firestore().doc('firePins/abcdefghijklmnopqrst')
    .update({ lat: 14.65 + 2_000 / METRES_PER_DEGREE_LAT }));
  await assertFails(memberDb.doc(locationPath).set(marker(northOfFire(990))));
  await assertSucceeds(memberDb.doc(locationPath).set(marker(northOfFire(1_990))));
  await env.withSecurityRulesDisabled(context => context.firestore().doc('firePins/abcdefghijklmnopqrst')
    .update({ lat: 14.65 }));
  await assertSucceeds(memberDb.doc(locationPath).set(marker({ lat: 14.65, lng: 121.06 })));
  // A responder whose fire was cleared cannot publish.
  await env.withSecurityRulesDisabled(context => context.firestore().doc('firePins/abcdefghijklmnopqrst').update({ status: 'cleared' }));
  await assertFails(memberDb.doc(locationPath).set(marker(northOfFire(100))));
  await env.withSecurityRulesDisabled(context => context.firestore().doc('firePins/abcdefghijklmnopqrst').update({ status: 'active' }));
  // Leaving the radius removes the marker; outside it only the heartbeat is written.
  await assertSucceeds(memberDb.doc(locationPath).delete());
  await assertSucceeds(memberDb.doc(responsePath).update({ lastLocationAt: serverTimestamp() }));
  await assertSucceeds(memberDb.doc(locationPath).set(marker({ lat: 14.65, lng: 121.06 })));

  const otherDb = dbFor('member-2');
  await assertSucceeds(headDb.doc(responsePath).get());
  await assertFails(otherDb.doc(responsePath).get());
  const publicLocation = await otherDb.doc(locationPath).get();
  assert.equal(publicLocation.data().uid, undefined);
  assert.equal(publicLocation.data().displayName, undefined);
  const publicLocations = await otherDb.collectionGroup('unitLocations').where('public', '==', true).get();
  assert.equal(publicLocations.size, 1);
  assert.equal(publicLocations.docs[0].id, responseId);
  await assertFails(otherDb.doc(noticePath).get());
  await assertSucceeds(headDb.doc('stationJoinRequests/new-member').get());
  await assertFails(otherDb.doc('stations/DILIMAN-01/unitLocations/not-a-real-response').set({
    responseId: 'not-a-real-response', stationId: 'DILIMAN-01', stationName: 'Diliman Fire Station',
    public: true, lat: 14.65, lng: 121.06, accuracy: 8, updatedAt: serverTimestamp(),
  }));
  await assertFails(memberDb.doc(locationPath).update({ uid: 'member-1' }));
  await assertFails(memberDb.doc(locationPath).update({ public: false }));

  await assertSucceeds(memberDb.doc(locationPath).delete());
  await assertSucceeds(memberDb.doc(locationPath).set(marker({ lat: 14.655, lng: 121.063 }, { accuracy: 7 })));

  // An active, approved responder may update only the GPS heartbeat.
  await assertSucceeds(memberDb.doc(responsePath).update({
    lastLocationAt: serverTimestamp(),
  }));

  // Changing the response status directly must remain prohibited.
  await assertFails(memberDb.doc(responsePath).update({
    status: 'ended',
  }));
  const end = memberDb.batch();
  end.update(memberDb.doc(responsePath), {
    status: 'ended',
    endedAt: serverTimestamp(),
    endedByUid: 'member-1',
    endedByName: 'Responder One',
    endReason: 'member',
  });
  end.update(memberDb.doc('users/member-1'), { activeResponseId: null });
  end.delete(memberDb.doc(locationPath));
  end.set(memberDb.doc(`stations/DILIMAN-01/notifications/${responseId}_end`), {
    type: 'response-ended',
    uid: 'member-1',
    displayName: 'Responder One',
    responseId,
    message: 'Responder One ended responding.',
    createdAt: serverTimestamp(),
  });
  await assertFails(end.commit());
  let endedLocation;
  await env.withSecurityRulesDisabled(async ctx => {
    endedLocation = await ctx.firestore().doc(locationPath).get();
  });
  assert.equal(endedLocation.exists, true);
  await assertSucceeds(headDb.doc(responsePath).get());

  const adminResponseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const adminResponsePath = `stationResponses/${adminResponseId}`;
  const adminLocationPath = `stations/SYSTEM_ADMIN/unitLocations/${adminResponseId}`;
  const adminNoticePath = `stations/SYSTEM_ADMIN/notifications/${adminResponseId}_start`;
  const adminStart = adminDb.batch();
  adminStart.update(adminDb.doc('users/admin'), { activeResponseId: adminResponseId });
  adminStart.set(adminDb.doc(adminResponsePath), {
    firePinId: 'abcdefghijklmnopqrst', incidentLat: 14.65, incidentLng: 121.06,
    responseId: adminResponseId, uid: 'admin', displayName: 'Admin',
    stationId: 'SYSTEM_ADMIN', stationName: 'System Administration', status: 'active',
    startedAt: serverTimestamp(), endedAt: null, lastLocationAt: serverTimestamp(),
  });
  adminStart.set(adminDb.doc(adminLocationPath), {
    responseId: adminResponseId, stationId: 'SYSTEM_ADMIN', stationName: 'System Administration',
    public: true, lat: 14.65, lng: 121.06, accuracy: 8, updatedAt: serverTimestamp(),
  });
  adminStart.set(adminDb.doc(adminNoticePath), {
    type: 'response-started', uid: 'admin', displayName: 'Admin', responseId: adminResponseId,
    message: 'Admin started responding.', createdAt: serverTimestamp(),
  });
  // Personal administrators may start using the reserved SYSTEM_ADMIN
  // identity without requiring ordinary station membership.
  await assertSucceeds(adminStart.commit());

  await env.withSecurityRulesDisabled(async context => {
    const storedResponse = await context.firestore()
      .doc(adminResponsePath).get();

    assert.equal(storedResponse.exists, true);
  });
  // An authorized personal Admin may update the response heartbeat
  // and delete their published marker.
  await assertSucceeds(adminDb.doc(adminResponsePath).update({
    lastLocationAt: serverTimestamp(),
  }));
  await assertSucceeds(adminDb.doc(adminLocationPath).delete());

  // An ordinary station member must never forge SYSTEM_ADMIN.
  const forgedSystemResponse = otherDb.batch();
  const forgedResponseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  forgedSystemResponse.update(otherDb.doc('users/member-2'), { activeResponseId: forgedResponseId });
  forgedSystemResponse.set(otherDb.doc(`stationResponses/${forgedResponseId}`), {
    firePinId: 'abcdefghijklmnopqrst', incidentLat: 14.65, incidentLng: 121.06,
    responseId: forgedResponseId, uid: 'member-2', displayName: 'Other Responder',
    stationId: 'SYSTEM_ADMIN', stationName: 'System Administration', status: 'active',
    startedAt: serverTimestamp(), endedAt: null, lastLocationAt: serverTimestamp(),
  });
  forgedSystemResponse.set(otherDb.doc(`stations/SYSTEM_ADMIN/unitLocations/${forgedResponseId}`), {
    responseId: forgedResponseId, stationId: 'SYSTEM_ADMIN', stationName: 'System Administration',
    public: true, lat: 14.65, lng: 121.06, accuracy: 8, updatedAt: serverTimestamp(),
  });
  forgedSystemResponse.set(otherDb.doc(`stations/SYSTEM_ADMIN/notifications/${forgedResponseId}_start`), {
    type: 'response-started', uid: 'member-2', displayName: 'Other Responder', responseId: forgedResponseId,
    message: 'Other Responder started responding.', createdAt: serverTimestamp(),
  });
  await assertFails(forgedSystemResponse.commit());
  console.log('Station response rules: all checks passed');
} finally {
  await env.cleanup();
}
