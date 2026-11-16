
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

const responseA = '11111111-1111-4111-8111-111111111111';
const responseB = '22222222-2222-4222-8222-222222222222';
const incidentId = 'abcdefghijklmnopqrst';

try {
  const now = Timestamp.now();

  await db.doc('users/responderA').set({
    accountType: 'person',
    role: 'authorized',
    stationId: 'stationA',
    displayName: 'Responder A',
    activeResponseId: responseA,
  });

  await db.doc('users/responderB').set({
    accountType: 'person',
    role: 'authorized',
    stationId: 'stationB',
    displayName: 'Responder B',
    activeResponseId: responseB,
  });

  await db.doc('users/outsider').set({
    accountType: 'person',
    role: 'authorized',
    stationId: 'stationC',
    displayName: 'Outsider',
  });

  for (const [id, uid, stationId] of [
    [responseA, 'responderA', 'stationA'],
    [responseB, 'responderB', 'stationB'],
  ]) {
    await db.doc(`stationResponses/${id}`).set({
      responseId: id,
      uid,
      stationId,
      firePinId: incidentId,
      displayName: uid,
      status: 'active',
      lastLocationAt: now,
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

  await db.doc('hydrantOccupancy/HYD-401').set({
    hydrantId: 'HYD-401',
    responseId: responseA,
    firePinId: incidentId,
    claimedByUid: 'responderA',
  });

  await db.doc('hydrantOccupancy/HYD-402').set({
    hydrantId: 'HYD-402',
    responseId: responseB,
    firePinId: incidentId,
    claimedByUid: 'responderB',
  });

  // Another user cannot end responder A's response.
  await assert.rejects(
    endStationResponse(
      db, 'outsider', responseA, 'member',
    ),
    error => error.status === 403,
  );

  // End responder A's response.
  const result = await endStationResponse(
    db, 'responderA', responseA, 'member',
  );

  assert.equal(result.alreadyEnded, false);
  assert.equal(result.releasedHydrants, 1);

  assert.equal(
    (await db.doc(`stationResponses/${responseA}`).get())
      .data().status,
    'ended',
  );

  assert.equal(
    (await db.doc('users/responderA').get())
      .data().activeResponseId,
    null,
  );

  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-401').get()).exists,
    false,
  );

  // Another responder's hydrant remains occupied.
  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-402').get()).exists,
    true,
  );

  assert.equal(
    (await db.doc(`stationResponses/${responseB}`).get())
      .data().status,
    'active',
  );

  assert.equal(
    (
      await db.doc(
        `stations/stationA/unitLocations/${responseA}`,
      ).get()
    ).exists,
    false,
  );

  assert.equal(
    (await db.doc(`responseLocations/${responseA}`).get()).exists,
    false,
  );

  assert.equal(
    (
      await db.doc(
        `stations/stationA/notifications/${responseA}_end`,
      ).get()
    ).data()?.type,
    'response-ended',
  );

  // Repeated ending must not affect any other response.
  const repeated = await endStationResponse(
    db, 'responderA', responseA, 'member',
  );

  assert.equal(repeated.alreadyEnded, true);
  assert.equal(repeated.releasedHydrants, 0);

  assert.equal(
    (await db.doc('hydrantOccupancy/HYD-402').get()).exists,
    true,
  );

  console.log(
    'PASS: Response ownership, hydrant cleanup, ' +
    'location cleanup, notifications, and isolation.',
  );
} finally {
  await deleteApp(app);
}
