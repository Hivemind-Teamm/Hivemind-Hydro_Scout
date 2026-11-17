import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('STOP: Firestore emulator required.');
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
    name => name.startsWith('.')
      ? load(path.resolve(path.dirname(file), `${name}.ts`))
      : require(name),
    exports,
  );

  return exports;
}

const { claimHydrant } = load(
  path.resolve('lib/hydrant-occupancy-service.ts'),
);

test('hydrant claims enforce authorization and exclusivity', async () => {
  const app = initializeApp({
    projectId: 'demo-hydrant-occupancy',
  });

  const db = getFirestore(app);
  const incidentId = 'abcdefghijklmnopqrst';

  try {
    const user = (uid, role, stationId) =>
      db.doc(`users/${uid}`).set({
        accountType: 'person',
        role,
        stationId,
      });

    await Promise.all([
      user('responderA', 'authorized', 'stationA'),
      user('responderB', 'authorized', 'stationB'),
      user('visitor', 'general', 'stationA'),
      user('noResponse', 'authorized', 'stationA'),

      db.doc(`firePins/${incidentId}`).set({
        status: 'active',
        stationId: 'stationA',
      }),

      db.doc('hydrants/HYD-101').set({
        operationalStatus: 'Operational',
      }),

      db.doc('hydrants/HYD-102').set({
        operationalStatus: 'Operational',
      }),

      db.doc('stationResponses/responseA').set({
        uid: 'responderA',
        stationId: 'stationA',
        firePinId: incidentId,
        status: 'active',
      }),

      db.doc('stationResponses/responseB').set({
        uid: 'responderB',
        stationId: 'stationB',
        firePinId: incidentId,
        status: 'active',
      }),
    ]);

    // Authorized responder claims an available hydrant.
    const first = await claimHydrant(
      db, 'responderA', 'HYD-101', incidentId,
    );

    assert.equal(first.alreadyClaimed, false);

    const stored = await db.doc(
      'hydrantOccupancy/HYD-101',
    ).get();

    assert.equal(stored.data()?.claimedByUid, 'responderA');
    assert.equal(stored.data()?.firePinId, incidentId);

    // Repeating the same claim must be harmless.
    const repeated = await claimHydrant(
      db, 'responderA', 'HYD-101', incidentId,
    );

    assert.equal(repeated.alreadyClaimed, true);

    // Another responder cannot take an occupied hydrant.
    await assert.rejects(
      claimHydrant(db, 'responderB', 'HYD-101', incidentId),
      error => error.status === 409,
    );

    // A general user cannot claim hydrants.
    await assert.rejects(
      claimHydrant(db, 'visitor', 'HYD-102', incidentId),
      error => error.status === 403,
    );

    // An authorized user without an active response is denied.
    await assert.rejects(
      claimHydrant(db, 'noResponse', 'HYD-102', incidentId),
      error => error.status === 403,
    );

    // Concurrent claims must produce only one winner.
    const competing = await Promise.allSettled([
      claimHydrant(db, 'responderA', 'HYD-102', incidentId),
      claimHydrant(db, 'responderB', 'HYD-102', incidentId),
    ]);

    assert.equal(
      competing.filter(result => result.status === 'fulfilled').length,
      1,
    );

    assert.equal(
      competing.filter(result => result.status === 'rejected').length,
      1,
    );

    // Once an incident is cleared, new claims are denied.
    await db.doc(`firePins/${incidentId}`).update({
      status: 'cleared',
    });

    await assert.rejects(
      claimHydrant(db, 'responderA', 'HYD-102', incidentId),
      error => error.status === 409,
    );

    console.log('Hydrant claim security checks passed.');
  } finally {
    await deleteApp(app);
  }
});
