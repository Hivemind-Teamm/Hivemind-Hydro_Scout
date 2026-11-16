
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Firestore emulator required.');
}

const require = createRequire(import.meta.url);
const cache = new Map();

function load(file) {
  if (cache.has(file)) {
    return cache.get(file);
  }

  const exports = {};
  cache.set(file, exports);

  const code = ts.transpileModule(
    readFileSync(file, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  new Function('require', 'exports', code)(
    id =>
      id.startsWith('.')
        ? load(path.resolve(path.dirname(file), `${id}.ts`))
        : require(id),
    exports,
  );

  return exports;
}

const { clearFireIncident } = load(
  path.resolve('lib/clear-fire-incident.ts'),
);

const app = initializeApp({
  projectId: 'demo-hydrant-occupancy',
});

const db = getFirestore(app);

const pinId = 'abcdefghijklmnopqrst';
const otherPinId = 'anotherincidentpin00';

try {
  const now = Timestamp.now();

  // --------------------------------------------------
  // TEST SETUP: USERS
  // --------------------------------------------------

  await db.doc('users/creator').set({
    accountType: 'person',
    role: 'authorized',
    stationId: 'one',
    displayName: 'Creator',
  });

  await db.doc('users/outsider').set({
    accountType: 'person',
    role: 'authorized',
    stationId: 'two',
  });

  await db.doc('users/visitor').set({
    accountType: 'person',
    role: 'general',
    stationId: 'one',
  });

  // --------------------------------------------------
  // TEST SETUP: FIRE INCIDENTS
  // --------------------------------------------------

  await db.doc(`firePins/${pinId}`).set({
    stationId: 'one',
    status: 'active',
    lat: 14.65,
    lng: 121.06,
    createdAt: now,
    updatedAt: now,
  });

  await db.doc(`firePinOwners/${pinId}`).set({
    uid: 'creator',
  });

  // Incident B must have coordinates.
  // Its clearance generates a station notification
  // containing latitude and longitude.
  await db.doc(`firePins/${otherPinId}`).set({
    stationId: 'one',
    status: 'active',
    lat: 14.66,
    lng: 121.07,
    createdAt: now,
    updatedAt: now,
  });

  // --------------------------------------------------
  // TEST SETUP: STATION RESPONDERS
  // --------------------------------------------------

  for (
    const [id, stationId, firePinId] of [
      ['a', 'one', pinId],
      ['b', 'two', pinId],
      ['c', 'one', otherPinId],
    ]
  ) {
    await db.doc(`users/${id}`).set({
      activeResponseId: id,
    });

    await db.doc(`stationResponses/${id}`).set({
      uid: id,
      displayName: id,
      stationId,
      firePinId,
      status: 'active',
    });

    await db.doc(
      `stations/${stationId}/unitLocations/${id}`,
    ).set({
      lat: 14,
    });

    await db.doc(`responseLocations/${id}`).set({
      lat: 14,
    });
  }

  // --------------------------------------------------
  // TEST SETUP: HYDRANT OCCUPANCY
  // --------------------------------------------------

  await db.doc('hydrantOccupancy/HYD-301').set({
    hydrantId: 'HYD-301',
    firePinId: pinId,
    responseId: 'a',
    claimedByUid: 'a',
    claimedAt: now,
  });

  await db.doc('hydrantOccupancy/HYD-302').set({
    hydrantId: 'HYD-302',
    firePinId: otherPinId,
    responseId: 'c',
    claimedByUid: 'c',
    claimedAt: now,
  });

  // --------------------------------------------------
  // TEST 1: AUTHORIZATION
  // --------------------------------------------------

  await assert.rejects(
    clearFireIncident(db, 'outsider', pinId),
    error => error.status === 403,
  );

  await assert.rejects(
    clearFireIncident(db, 'visitor', pinId),
    error => error.status === 403,
  );

  assert.equal(
    (await db.doc(`firePins/${pinId}`).get()).data().status,
    'active',
  );

  // --------------------------------------------------
  // TEST 2: CLEAR INCIDENT A
  // --------------------------------------------------

  const result = await clearFireIncident(
    db,
    'creator',
    pinId,
  );

  console.log('INCIDENT CLEAR RESULT:', result);

  assert.equal(result.endedResponses, 2);
  assert.equal(result.releasedHydrants, 1);

  assert.equal(
    (await db.doc(`firePins/${pinId}`).get()).data().status,
    'cleared',
  );

  // Incident A's hydrant must be released.
  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-301').get()).exists,
    false,
  );

  // Incident B's hydrant must remain occupied.
  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-302').get()).exists,
    true,
  );

  // --------------------------------------------------
  // TEST 3: STATION CLEARANCE NOTIFICATIONS
  // --------------------------------------------------

  for (const station of ['one', 'two']) {
    const notificationRef = db.doc(
      `stations/${station}/notifications/fire-${pinId}-cleared`,
    );

    const notificationSnapshot = await notificationRef.get();
    const clearedNotice = notificationSnapshot.data();

    console.log('NOTIFICATION DEBUG:', {
      station,
      path: notificationRef.path,
      exists: notificationSnapshot.exists,
      data: clearedNotice,
    });

    assert.equal(
      clearedNotice?.type,
      'fire-cleared',
      `Missing fire-cleared notification for station ${station}`,
    );

    assert.equal(clearedNotice.firePinId, pinId);
    assert.equal(clearedNotice.lat, 14.65);
    assert.equal(clearedNotice.lng, 121.06);
    assert.ok(clearedNotice.startedAt);
  }

  // --------------------------------------------------
  // TEST 4: RESPONSE TERMINATION AND CLEANUP
  // --------------------------------------------------

  for (
    const [id, station] of [
      ['a', 'one'],
      ['b', 'two'],
    ]
  ) {
    const response = (
      await db.doc(`stationResponses/${id}`).get()
    ).data();

    assert.equal(response.status, 'ended');
    assert.equal(response.endReason, 'incident-cleared');

    assert.equal(
      (await db.doc(`users/${id}`).get()).data().activeResponseId,
      null,
    );

    assert.equal(
      (
        await db.doc(
          `stations/${station}/unitLocations/${id}`,
        ).get()
      ).exists,
      false,
    );

    assert.equal(
      (await db.doc(`responseLocations/${id}`).get()).exists,
      false,
    );

    assert.equal(
      (
        await db.doc(
          `stations/${station}/notifications/${id}_end`,
        ).get()
      ).data()?.type,
      'response-ended',
    );
  }

  // --------------------------------------------------
  // TEST 5: INCIDENT ISOLATION
  // --------------------------------------------------

  assert.equal(
    (await db.doc('stationResponses/c').get()).data().status,
    'active',
  );

  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-302').get()).exists,
    true,
  );

  // --------------------------------------------------
  // TEST 6: REPEATED CLEARING
  // --------------------------------------------------

  const repeated = await clearFireIncident(
    db,
    'creator',
    pinId,
  );

  assert.equal(repeated.endedResponses, 0);
  assert.equal(repeated.releasedHydrants, 0);

  // --------------------------------------------------
  // TEST 7: LEGACY RESPONSE PROTECTION
  // --------------------------------------------------

  await db.doc('stationResponses/legacy').set({
    uid: 'legacy',
    displayName: 'Legacy',
    stationId: 'one',
    status: 'active',
  });

  await db.doc('users/legacy').set({
    activeResponseId: 'a-newer-response',
  });

  // The legacy response must remain active while
  // another active incident still exists.
  assert.equal(
    (await clearFireIncident(db, 'creator', pinId)).endedResponses,
    0,
  );

  assert.equal(
    (await db.doc('stationResponses/legacy').get()).data().status,
    'active',
  );

  // --------------------------------------------------
  // TEST 8: ADMINISTRATOR CLEARS INCIDENT B
  // --------------------------------------------------

  await db.doc('users/admin').set({
    role: 'admin',
    accountType: 'person',
    displayName: 'Admin',
  });

  const adminResult = await clearFireIncident(
    db,
    'admin',
    otherPinId,
  );

  assert.equal(adminResult.endedResponses, 2);
  assert.equal(adminResult.releasedHydrants, 1);

  assert.equal(
    (await db.doc(`firePins/${otherPinId}`).get()).data().status,
    'cleared',
  );

  assert.equal(
    (await db.doc('stationResponses/c').get()).data().status,
    'ended',
  );

  assert.equal(
    (await db.doc('stationResponses/legacy').get()).data().status,
    'ended',
  );

  // The existing newer response pointer must not be removed.
  assert.equal(
    (await db.doc('users/legacy').get()).data().activeResponseId,
    'a-newer-response',
  );

  // Incident B's hydrant should now be available.
  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-302').get()).exists,
    false,
  );

  console.log(
    'PASS: Incident clearance, station notifications, ' +
    'response isolation, authorization, legacy sessions, ' +
    'and hydrant occupancy cleanup.',
  );
} finally {
  await deleteApp(app);
}
