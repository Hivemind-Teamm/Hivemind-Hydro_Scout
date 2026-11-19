import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';

const env = await initializeTestEnvironment({
  projectId: 'demo-station-approval',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
  },
});

const serverTimestamp = () =>
  firebase.firestore.FieldValue.serverTimestamp();

const actors = [
  { uid: 'head-one', role: 'head', stationId: 'one' },
  { uid: 'head-two', role: 'head', stationId: 'two' },
  { uid: 'admin', role: 'admin', stationId: null },
  { uid: 'authorized', role: 'authorized', stationId: 'one' },
  { uid: 'general', role: 'general', stationId: 'one' },
];

async function seedApplicant(uid) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await db.doc(`users/${uid}`).set({
      uid,
      email: `${uid}@example.test`,
      displayName: 'Test Applicant',
      role: 'general',
      accountType: 'person',
      stationId: null,
      station: 'Unassigned',
      stationMembershipStatus: 'pending',
      requestedStationId: 'one',
    });

    await db.doc(`stationJoinRequests/${uid}`).set({
      uid,
      email: `${uid}@example.test`,
      displayName: 'Test Applicant',
      stationId: 'one',
      status: 'pending',
      createdAt: new Date(),
    });
  });
}

async function reviewAs(actorUid, applicantUid, approved) {
  const db = env.authenticatedContext(actorUid).firestore();

  const status = approved ? 'approved' : 'rejected';
  const batch = db.batch();

  batch.update(db.doc(`stationJoinRequests/${applicantUid}`), {
    status,
    reviewedAt: serverTimestamp(),
    reviewedBy: actorUid,
  });

  batch.update(db.doc(`users/${applicantUid}`), {
    stationMembershipStatus: status,
    stationId: approved ? 'one' : null,
    station: approved ? 'Station One' : 'Unassigned',
    requestedStationId: null,
  });

  batch.set(
    db.doc(
      `stations/one/notifications/join-review-${applicantUid}-${status}`
    ),
    {
      type: approved
        ? 'membership-approved'
        : 'membership-rejected',
      uid: applicantUid,
      displayName: 'Test Applicant',
      message: `Test Applicant's request was ${status}.`,
      createdAt: serverTimestamp(),
    }
  );

  return batch.commit();
}

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await db.doc('stations/one').set({
      name: 'Station One',
      active: true,
      aorBarangays: [],
    });

    await db.doc('stations/two').set({
      name: 'Station Two',
      active: true,
      aorBarangays: [],
    });

    for (const actor of actors) {
      await db.doc(`users/${actor.uid}`).set({
        uid: actor.uid,
        accountType: 'person',
        role: actor.role,
        stationId: actor.stationId,
        station: actor.stationId ?? 'Unassigned',
      });
    }

    await db.doc('stationAccountIndex/station-login').set({
      stationId: 'one',
    });

    await db.doc(
      'stations/one/accounts/station-login'
    ).set({
      uid: 'station-login',
      accountType: 'station',
      stationId: 'one',
      role: 'head',
    });
  });

  await test('Personal Head can approve and reject', async () => {
    for (const approved of [true, false]) {
      const uid = `valid-${approved ? 'approve' : 'reject'}`;

      await seedApplicant(uid);
      await assertSucceeds(reviewAs('head-one', uid, approved));
    }
  });

  for (const actorUid of [
    'head-two',
    'station-login',
    'admin',
    'authorized',
    'general',
  ]) {
    await test(`${actorUid} cannot approve or reject`, async () => {
      for (const approved of [true, false]) {
        const uid = `${actorUid}-${approved ? 'yes' : 'no'}`;

        await seedApplicant(uid);
        await assertFails(reviewAs(actorUid, uid, approved));
      }
    });
  }

  await test('Shared station login cannot directly approve user profile', async () => {
    const uid = 'direct-status-bypass';

    await seedApplicant(uid);

    const db = env.authenticatedContext(
      'station-login'
    ).firestore();

    await assertFails(
      db.doc(`users/${uid}`).update({
        stationMembershipStatus: 'approved',
        stationId: 'one',
        station: 'Station One',
        requestedStationId: null,
      })
    );
  });

  await test('Denied attempts leave applicant request pending', async () => {
    const db = env.authenticatedContext(
      'head-one'
    ).firestore();

    const snapshot = await assertSucceeds(
      db.doc('stationJoinRequests/direct-status-bypass').get()
    );

    assert.equal(snapshot.data()?.status, 'pending');
  });
} finally {
  await env.cleanup();
}
