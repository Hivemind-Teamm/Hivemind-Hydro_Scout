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

const { claimHydrant, releaseHydrant } = load(
  path.resolve('lib/hydrant-occupancy-service.ts'),
);

test('hydrant release authorization and lifecycle', async () => {
  const app = initializeApp({
    projectId: 'demo-hydrant-occupancy',
  });

  const db = getFirestore(app);
  const incidentId = 'abcdefghijklmnopqrst';

  try {
    await Promise.all([
      db.doc('users/owner').set({
        accountType: 'person',
        role: 'authorized',
        stationId: 'stationA',
      }),
      db.doc('users/outsider').set({
        accountType: 'person',
        role: 'authorized',
        stationId: 'stationB',
      }),
      db.doc('users/visitor').set({
        accountType: 'person',
        role: 'general',
        stationId: 'stationA',
      }),
      db.doc('users/admin').set({
        accountType: 'person',
        role: 'admin',
      }),
      db.doc(`firePins/${incidentId}`).set({
        status: 'active',
        stationId: 'stationA',
      }),
      db.doc('hydrants/HYD-201').set({
        operationalStatus: 'Operational',
      }),
      db.doc('hydrants/HYD-202').set({
        operationalStatus: 'Operational',
      }),
      db.doc('stationResponses/responseOwner').set({
        uid: 'owner',
        stationId: 'stationA',
        firePinId: incidentId,
        status: 'active',
      }),
    ]);

    await claimHydrant(
      db, 'owner', 'HYD-201', incidentId,
    );

    // Another responder must not release this claim.
    await assert.rejects(
      releaseHydrant(db, 'outsider', 'HYD-201', incidentId),
      error => error.status === 403,
    );

    // General users must not release occupied hydrants.
    await assert.rejects(
      releaseHydrant(db, 'visitor', 'HYD-201', incidentId),
      error => error.status === 403,
    );

    // Mismatched incident IDs must be rejected.
    await assert.rejects(
      releaseHydrant(
        db, 'owner', 'HYD-201', 'bbbbbbbbbbbbbbbbbbbb',
      ),
      error => error.status === 409,
    );

    // Original claimant can release their hydrant.
    const released = await releaseHydrant(
      db, 'owner', 'HYD-201', incidentId,
    );

    assert.equal(released.released, true);
    assert.equal(
      (await db.doc('hydrantOccupancy/HYD-201').get()).exists,
      false,
    );

    // Repeated release should be safe.
    const repeated = await releaseHydrant(
      db, 'owner', 'HYD-201', incidentId,
    );

    assert.equal(repeated.alreadyAvailable, true);

    // Administrator can release a claim.
    await claimHydrant(
      db, 'owner', 'HYD-202', incidentId,
    );

    const adminRelease = await releaseHydrant(
      db, 'admin', 'HYD-202', incidentId,
    );

    assert.equal(adminRelease.released, true);

    console.log('Hydrant release security checks passed.');
  } finally {
    await deleteApp(app);
  }
});
