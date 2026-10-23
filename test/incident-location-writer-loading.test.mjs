import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { createIncidentFixtures } from './incident-api-fixtures.mjs';

const PROJECT = 'demo-hydro-scout-api';

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
  process.env.NODE_ENV === 'production'
) {
  throw new Error('Exact local demo emulator configuration required.');
}

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function transpile(source, filename) {
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
    reportDiagnostics: true,
  });

  const errors = (result.diagnostics ?? []).filter(
    diagnostic => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  assert.equal(
    errors.length,
    0,
    `TypeScript compilation errors in ${filename}`,
  );

  return result.outputText;
}

test('Actual incident-location writer loads without publishing GPS', async () => {
  const suffix = randomUUID();
  const deviceFilename = `.incident-device-id-test-${suffix}.mjs`;
  const writerFilename = `.incident-location-writer-test-${suffix}.mjs`;
  const cleanupFilename = `.incident-device-cleanup-test-${suffix}.mjs`;

  const devicePath = path.join(root, 'lib', deviceFilename);
  const writerPath = path.join(root, 'lib', writerFilename);
  const cleanupPath = path.join(root, 'lib', cleanupFilename);

  try {
    const deviceSource = await readFile(
      path.join(root, 'lib', 'incident-device-id.ts'),
      'utf8',
    );

    const writerSource = await readFile(
      path.join(root, 'lib', 'incident-location-writer.ts'),
      'utf8',
    );

    const cleanupSource = await readFile(
      path.join(root, 'lib', 'incident-device-location-cleanup.ts'),
      'utf8',
    );

    const compiledDevice = transpile(
      deviceSource,
      'incident-device-id.ts',
    );

    let compiledWriter = transpile(
      writerSource,
      'incident-location-writer.ts',
    );

    const originalImport = "from './incident-device-id'";
    const temporaryImport = `from './${deviceFilename}'`;

    assert.equal(
      compiledWriter.includes(originalImport),
      true,
      'Expected device identity import not found',
    );

    compiledWriter = compiledWriter.replace(
      originalImport,
      temporaryImport,
    );

    // The type-only LocationFix import disappears during transpilation.
    assert.equal(
      compiledWriter.includes(
        "from './incident-location-algorithm'",
      ),
      false,
    );

    let compiledCleanup = transpile(
      cleanupSource,
      'incident-device-location-cleanup.ts',
    );

    assert.equal(
      compiledCleanup.includes(originalImport),
      true,
      'Expected cleanup device identity import not found',
    );

    compiledCleanup = compiledCleanup.replace(
      originalImport,
      temporaryImport,
    );

    await writeFile(devicePath, compiledDevice, { flag: 'wx' });
    await writeFile(writerPath, compiledWriter, { flag: 'wx' });
    await writeFile(cleanupPath, compiledCleanup, { flag: 'wx' });

    const module = await import(pathToFileURL(writerPath).href);
    const cleanupModule = await import(pathToFileURL(cleanupPath).href);

    assert.equal(
      typeof cleanupModule.deleteIncidentDeviceLocation,
      'function',
    );

    assert.equal(
      typeof module.createIncidentLocationWriter,
      'function',
    );

    // Use a separate Firebase app connected ONLY to local emulators.
    const fixtures = await createIncidentFixtures();
    const clientApp = initializeApp(
      {
        projectId: PROJECT,
        apiKey: 'demo-emulator-only-key',
        authDomain: 'localhost',
      },
      `incident-writer-test-${suffix}`,
    );

    const auth = getAuth(clientApp);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });

    const clientDb = getFirestore(clientApp);
    connectFirestoreEmulator(clientDb, '127.0.0.1', 8080);

    const originalWindow = globalThis.window;
    const deviceUUID = '550e8400-e29b-41d4-a716-446655440000';

    globalThis.window = {
      localStorage: {
        getItem: key =>
          key === 'hydroscout-incident-device-id'
            ? deviceUUID
            : null,
      },
    };

    try {
      const account = fixtures.accounts.sub_admin;

      await signInWithEmailAndPassword(
        auth,
        account.email,
        account.password,
      );

      assert.equal(auth.currentUser?.uid, account.uid);

      const writer = module.createIncidentLocationWriter({
        db: clientDb,
        uid: account.uid,
        stationId: 'TEST-STATION-001',
        getCurrentUid: () => auth.currentUser?.uid ?? null,
      });

      assert.equal(
        writer.locationId,
        `${account.uid}_${deviceUUID}`,
      );

      const locationRef = fixtures.db
        .collection('unitLocations')
        .doc(writer.locationId);

      // 1. A valid assigned Sub Admin can publish nearby.
      await writer.writeLocation(
        fixtures.incidentId,
        {
          lat: 14.6501,
          lng: 121.0601,
          accuracy: 8,
        },
      );

      const created = await locationRef.get();

      assert.equal(created.exists, true);
      assert.equal(created.data().stationId, 'TEST-STATION-001');
      assert.equal(created.data().updatedBy, account.uid);
      assert.equal(created.data().incidentId, fixtures.incidentId);
      assert.equal(created.data().accuracy, 8);
      assert.equal(created.data().location.latitude, 14.6501);
      assert.equal(created.data().location.longitude, 121.0601);
      assert.ok(created.data().updatedAt);

      assert.deepEqual(
        Object.keys(created.data()).sort(),
        [
          'stationId',
          'updatedBy',
          'incidentId',
          'location',
          'accuracy',
          'updatedAt',
        ].sort(),
      );

      // 2. Trusted server revocation must block further writes.
      await fixtures.db
        .collection('incidents')
        .doc(fixtures.incidentId)
        .update({ assignedStationIds: [] });

      await assert.rejects(
        writer.writeLocation(
          fixtures.incidentId,
          {
            lat: 14.6502,
            lng: 121.0602,
            accuracy: 7,
          },
        ),
      );

      // 3. Revocation must NOT prevent owner cleanup.
      await writer.deleteLocation();

      const deleted = await locationRef.get();
      assert.equal(deleted.exists, false);

      // 4. Simulate a location left over from a previous page session.
      // Restore authorization temporarily to create the document.
      await fixtures.db
        .collection('incidents')
        .doc(fixtures.incidentId)
        .update({ assignedStationIds: ['TEST-STATION-001'] });

      await writer.writeLocation(
        fixtures.incidentId,
        {
          lat: 14.6501,
          lng: 121.0601,
          accuracy: 8,
        },
      );

      assert.equal((await locationRef.get()).exists, true);

      // Revoke the assignment again before standalone cleanup.
      await fixtures.db
        .collection('incidents')
        .doc(fixtures.incidentId)
        .update({ assignedStationIds: [] });

      // No active GPS controller is required for this operation.
      await cleanupModule.deleteIncidentDeviceLocation({
        db: clientDb,
        uid: account.uid,
        getCurrentUid: () => auth.currentUser?.uid ?? null,
      });

      assert.equal((await locationRef.get()).exists, false);

      // Cleanup must reject a different authenticated identity.
      await assert.rejects(
        cleanupModule.deleteIncidentDeviceLocation({
          db: clientDb,
          uid: account.uid,
          getCurrentUid: () => 'different-user',
        }),
        /location-session-changed/,
      );
    } finally {
      globalThis.window = originalWindow;

      try {
        await signOut(auth);
      } finally {
        try {
          await deleteApp(clientApp);
        } finally {
          await fixtures.cleanup();
        }
      }
    }
  } finally {
    await Promise.allSettled([
      unlink(devicePath),
      unlink(writerPath),
      unlink(cleanupPath),
    ]);
  }
});