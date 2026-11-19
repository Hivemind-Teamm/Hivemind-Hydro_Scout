import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

const projectId = 'demo-response-location-consent';
const responseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const stationId = 'DILIMAN-01';
const firePinId = 'abcdefghijklmnopqrst';

let env;

const marker = db => doc(
  db,
  'stations',
  stationId,
  'unitLocations',
  responseId,
);

const markerData = () => ({
  responseId,
  stationId,
  stationName: 'Diliman Fire Station',
  public: true,
  lat: 14.65,
  lng: 121.06,
  accuracy: 8,
  updatedAt: serverTimestamp(),
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', 'member-1'), {
      uid: 'member-1',
      role: 'general',
      accountType: 'person',
      stationId,
      stationMembershipStatus: 'approved',
      displayName: 'Responder One',
      activeResponseId: responseId,
    });

    await setDoc(doc(db, 'stations', stationId), {
      name: 'Diliman Fire Station',
      active: true,
    });

    await setDoc(doc(db, 'firePins', firePinId), {
      lat: 14.65,
      lng: 121.06,
      stationId,
      status: 'active',
    });

    await setDoc(doc(db, 'stationResponses', responseId), {
      responseId,
      uid: 'member-1',
      displayName: 'Responder One',
      stationId,
      stationName: 'Diliman Fire Station',
      status: 'active',
      firePinId,
      incidentLat: 14.65,
      incidentLng: 121.06,
    });

    await setDoc(doc(db, 'appSettings', 'locationPrivacy'), {
      controller: 'HydroScout Project Organization',
      contact: 'privacy@example.com',
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-user',
    });
  });
});

after(async () => {
  await env?.cleanup();
});

test('authorized responder has valid active-response fixture', async () => {
  const db = env.authenticatedContext('member-1').firestore();

  // An authenticated responder can read their own response.
  const response = await assertSucceeds(
    import('firebase/firestore').then(({ getDoc }) =>
      getDoc(doc(db, 'stationResponses', responseId))),
  );

  assert.equal(response.data().uid, 'member-1');
});

test('GPS publication without server-backed consent is denied', async () => {
  const db = env.authenticatedContext('member-1').firestore();

  // EXPECTED RED TEST:
  // Current rules authorize the active responder without
  // independently checking a server-backed consent record.
  await assertFails(
    setDoc(marker(db), markerData()),
  );
});