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
    await db.doc('stations/DILIMAN-01').set({ name: 'Diliman Fire Station', active: true, createdAt: serverTimestamp() });
    await db.doc('stations/DILIMAN-01/accounts/head-1').set({
      uid: 'head-1', accountType: 'station', stationId: 'DILIMAN-01',
      displayName: 'Diliman Fire Station',
    });
    await db.doc('stationAccountIndex/head-1').set({ stationId: 'DILIMAN-01' });
    await db.doc('users/member-1').set({
      role: 'general', accountType: 'person', stationId: 'DILIMAN-01',
      stationMembershipStatus: 'approved', displayName: 'Responder One', activeResponseId: null,
    });
    await db.doc('users/member-2').set({
      role: 'general', accountType: 'person', stationId: 'DILIMAN-02',
      stationMembershipStatus: 'approved', displayName: 'Other Responder',
    });
  });

  const dbFor = uid => env.authenticatedContext(uid).firestore();
  const newMemberDb = dbFor('new-member');
  const headDb = dbFor('head-1');
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

  const responseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const responsePath = `stationResponses/${responseId}`;
  const locationPath = `stations/DILIMAN-01/unitLocations/${responseId}`;
  const noticePath = `stations/DILIMAN-01/notifications/${responseId}_start`;

  const memberDb = dbFor('member-1');
  const start = memberDb.batch();
  start.update(memberDb.doc('users/member-1'), { activeResponseId: responseId });
  start.set(memberDb.doc(responsePath), {
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
  start.set(memberDb.doc(locationPath), {
    responseId,
    stationId: 'DILIMAN-01',
    stationName: 'Diliman Fire Station',
    public: true,
    lat: 14.65,
    lng: 121.06,
    accuracy: 8,
    updatedAt: serverTimestamp(),
  });
  start.set(memberDb.doc(noticePath), {
    type: 'response-started',
    uid: 'member-1',
    displayName: 'Responder One',
    responseId,
    message: 'Responder One started responding.',
    createdAt: serverTimestamp(),
  });
  await assertSucceeds(start.commit());

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
  await assertSucceeds(memberDb.doc(locationPath).set({
    responseId,
    stationId: 'DILIMAN-01',
    stationName: 'Diliman Fire Station',
    public: true,
    lat: 14.66,
    lng: 121.07,
    accuracy: 7,
    updatedAt: serverTimestamp(),
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
  await assertSucceeds(end.commit());
  let endedLocation;
  await env.withSecurityRulesDisabled(async ctx => {
    endedLocation = await ctx.firestore().doc(locationPath).get();
  });
  assert.equal(endedLocation.exists, false);
  await assertSucceeds(headDb.doc(responsePath).get());
  console.log('Station response rules: all checks passed');
} finally {
  await env.cleanup();
}
