
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
  if (cache.has(file)) return cache.get(file);

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
    id => id.startsWith('.')
      ? load(path.resolve(path.dirname(file), `${id}.ts`))
      : require(id),
    exports,
  );

  return exports;
}

const { endStationResponse } = load(
  path.resolve('lib/end-station-response.ts'),
);

const app = initializeApp({
  projectId: 'demo-hydrant-occupancy',
});

const db = getFirestore(app);

const staleId = '33333333-3333-4333-8333-333333333333';
const freshId = '44444444-4444-4444-8444-444444444444';
const otherId = '55555555-5555-4555-8555-555555555555';

const oldTimestamp = Timestamp.fromMillis(
  Date.now() - 365 * 24 * 60 * 60 * 1000,
);

const currentTimestamp = Timestamp.now();

try {
  // --------------------------------------------------
  // USERS
  // --------------------------------------------------

  await Promise.all([
    db.doc('users/manager').set({
      accountType: 'person',
      role: 'head',
      stationId: 'stationA',
      displayName: 'Station A Manager',
    }),

    db.doc('users/otherManager').set({
      accountType: 'person',
      role: 'head',
      stationId: 'stationB',
      displayName: 'Station B Manager',
    }),

    db.doc('users/owner').set({
      accountType: 'person',
      role: 'authorized',
      stationId: 'stationA',
      displayName: 'Responder Owner',
      activeResponseId: staleId,
    }),

    db.doc('users/freshOwner').set({
      accountType: 'person',
      role: 'authorized',
      stationId: 'stationA',
      displayName: 'Fresh Responder',
      activeResponseId: freshId,
    }),

    db.doc('users/otherOwner').set({
      accountType: 'person',
      role: 'authorized',
      stationId: 'stationB',
      displayName: 'Other Responder',
      activeResponseId: otherId,
    }),
  ]);

  // --------------------------------------------------
  // RESPONSES
  // --------------------------------------------------

  for (const [id, uid, stationId, lastLocationAt] of [
    [staleId, 'owner', 'stationA', oldTimestamp],
    [freshId, 'freshOwner', 'stationA', currentTimestamp],
    [otherId, 'otherOwner', 'stationB', oldTimestamp],
  ]) {
    await db.doc(`stationResponses/${id}`).set({
      responseId: id,
      uid,
      stationId,
      displayName: uid,
      status: 'active',
      lastLocationAt,
    });

    await db.doc(
      `stations/${stationId}/unitLocations/${id}`,
    ).set({
      lat: 14.65,
    });

    await db.doc(`responseLocations/${id}`).set({
      lat: 14.65,
    });
  }

  // --------------------------------------------------
  // OCCUPANCY CLAIMS
  // --------------------------------------------------

  for (const [hydrantId, responseId] of [
    ['HYD-501', staleId],
    ['HYD-502', freshId],
    ['HYD-503', otherId],
  ]) {
    await db.doc(`hydrantOccupancy/${hydrantId}`).set({
      hydrantId,
      responseId,
      firePinId: 'abcdefghijklmnopqrst',
    });
  }

  // --------------------------------------------------
  // TEST 1: CROSS-STATION ACCESS DENIED
  // --------------------------------------------------

  await assert.rejects(
    endStationResponse(
      db,
      'otherManager',
      staleId,
      'station-head',
    ),
    error => error.status === 403,
  );

  // --------------------------------------------------
  // TEST 2: FRESH RESPONSE CANNOT BE CLOSED
  // --------------------------------------------------

  await assert.rejects(
    endStationResponse(
      db,
      'manager',
      freshId,
      'station-head',
    ),
    error => error.status === 409,
  );

  assert.equal(
    (await db.doc(`stationResponses/${freshId}`).get())
      .data().status,
    'active',
  );

  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-502').get()).exists,
    true,
  );

  // --------------------------------------------------
  // TEST 3: STALE RESPONSE CAN BE CLOSED
  // --------------------------------------------------

  const result = await endStationResponse(
    db,
    'manager',
    staleId,
    'station-head',
  );

  assert.equal(result.alreadyEnded, false);
  assert.equal(result.releasedHydrants, 1);

  assert.equal(
    (await db.doc(`stationResponses/${staleId}`).get())
      .data().status,
    'ended',
  );

  assert.equal(
    (await db.doc('users/owner').get())
      .data().activeResponseId,
    null,
  );

  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-501').get()).exists,
    false,
  );

  assert.equal(
    (
      await db.doc(
        `stations/stationA/unitLocations/${staleId}`,
      ).get()
    ).exists,
    false,
  );

  assert.equal(
    (await db.doc(`responseLocations/${staleId}`).get())
      .exists,
    false,
  );

  assert.equal(
    (
      await db.doc(
        `stations/stationA/notifications/${staleId}_closed`,
      ).get()
    ).data()?.type,
    'station-response-closed',
  );

  // --------------------------------------------------
  // TEST 4: UNAUTHORIZED RETRY MUST BE DENIED
  // --------------------------------------------------

  await assert.rejects(
    endStationResponse(
      db,
      'otherManager',
      staleId,
      'station-head',
    ),
    error => error.status === 403,
  );

  await assert.rejects(
    endStationResponse(
      db,
      'freshOwner',
      staleId,
      'member',
    ),
    error => error.status === 403,
  );

  // --------------------------------------------------
  // TEST 5: AUTHORIZED RETRY IS HARMLESS
  // --------------------------------------------------

  const repeated = await endStationResponse(
    db,
    'manager',
    staleId,
    'station-head',
  );

  assert.equal(repeated.alreadyEnded, true);
  assert.equal(repeated.releasedHydrants, 0);

  // --------------------------------------------------
  // TEST 6: UNRELATED CLAIMS REMAIN OCCUPIED
  // --------------------------------------------------

  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-502').get()).exists,
    true,
  );

  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-503').get()).exists,
    true,
  );

  assert.equal(
    (await db.doc(`stationResponses/${otherId}`).get())
      .data().status,
    'active',
  );

  console.log(
    'PASS: Station manager authorization, stale response ' +
    'closure, unauthorized retries, and hydrant isolation.',
  );
} finally {
  await deleteApp(app);
}
