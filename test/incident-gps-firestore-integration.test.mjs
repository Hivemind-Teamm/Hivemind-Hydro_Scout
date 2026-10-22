import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
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
  process.env.NODE_ENV !== 'test' ||
  process.env.NEXT_PUBLIC_ENABLE_INCIDENT_TRACKING === 'true'
) {
  throw new Error('Local emulator-only environment required.');
}

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function compile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
    reportDiagnostics: true,
  });

  assert.equal(
    result.diagnostics?.filter(
      item => item.category === ts.DiagnosticCategory.Error
    ).length ?? 0,
    0,
    `TypeScript compilation failed: ${fileName}`,
  );

  return result.outputText;
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  assert.fail(message);
}

test('mock GPS -> real controller -> real Firestore -> cleanup', async () => {
  const suffix = randomUUID();
  const generated = [];

  const makePath = name => {
    const output = path.join(
      root,
      'lib',
      `.incident-e2e-${suffix}-${name}.mjs`,
    );
    generated.push(output);
    return output;
  };

  const devicePath = makePath('device');
  const algorithmPath = makePath('algorithm');
  const controllerPath = makePath('controller');
  const writerPath = makePath('writer');

  let fixtures;
  let clientApp;
  let auth;
  let controller;

  const originalWindow = globalThis.window;

  try {
    const files = await Promise.all([
      readFile(path.join(root, 'lib/incident-device-id.ts'), 'utf8'),
      readFile(path.join(root, 'lib/incident-location-algorithm.ts'), 'utf8'),
      readFile(path.join(root, 'lib/incident-location-controller.ts'), 'utf8'),
      readFile(path.join(root, 'lib/incident-location-writer.ts'), 'utf8'),
    ]);

    const deviceCode = compile(files[0], 'incident-device-id.ts');

    const algorithmCode = compile(
      files[1],
      'incident-location-algorithm.ts',
    ).replace(
      /from ['"]\.\/incident-location-config['"]/g,
      "from './incident-location-settings.mjs'",
    );

    const controllerCode = compile(
      files[2],
      'incident-location-controller.ts',
    )
      .replace(
        /from ['"]\.\/incident-location-algorithm['"]/g,
        `from './${path.basename(algorithmPath)}'`,
      )
      .replace(
        /from ['"]\.\/incident-location-config['"]/g,
        "from './incident-location-settings.mjs'",
      );

    const writerCode = compile(
      files[3],
      'incident-location-writer.ts',
    ).replace(
      /from ['"]\.\/incident-device-id['"]/g,
      `from './${path.basename(devicePath)}'`,
    );

    assert.ok(controllerCode.includes(path.basename(algorithmPath)));
    assert.ok(writerCode.includes(path.basename(devicePath)));
    assert.ok(algorithmCode.includes('incident-location-settings.mjs'));

    await writeFile(devicePath, deviceCode, { flag: 'wx' });
    await writeFile(algorithmPath, algorithmCode, { flag: 'wx' });
    await writeFile(controllerPath, controllerCode, { flag: 'wx' });
    await writeFile(writerPath, writerCode, { flag: 'wx' });

    const { createIncidentLocationController } = await import(
      pathToFileURL(controllerPath).href
    );
    const { createIncidentLocationWriter } = await import(
      pathToFileURL(writerPath).href
    );

    fixtures = await createIncidentFixtures();

    clientApp = initializeApp(
      {
        projectId: PROJECT,
        apiKey: 'demo-emulator-only-key',
        authDomain: 'localhost',
      },
      `incident-e2e-${suffix}`,
    );

    auth = getAuth(clientApp);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', {
      disableWarnings: true,
    });

    const db = getFirestore(clientApp);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);

    const account = fixtures.accounts.sub_admin;

    await signInWithEmailAndPassword(
      auth,
      account.email,
      account.password,
    );

    const deviceUUID = '550e8400-e29b-41d4-a716-446655440000';

    globalThis.window = {
      localStorage: {
        getItem: key =>
          key === 'hydroscout-incident-device-id'
            ? deviceUUID
            : null,
      },
    };

    const writer = createIncidentLocationWriter({
      db,
      uid: account.uid,
      stationId: 'TEST-STATION-001',
      getCurrentUid: () => auth.currentUser?.uid ?? null,
    });

    const locationRef = fixtures.db
      .collection('unitLocations')
      .doc(writer.locationId);

    let gpsCallback;
    let clearCount = 0;
    let watchCount = 0;
    const errors = [];

    const geolocation = {
      watchPosition(success) {
        gpsCallback = success;
        watchCount++;
        return watchCount;
      },
      clearWatch() {
        clearCount++;
      },
    };

    controller = createIncidentLocationController({
      geolocation,
      writeLocation: writer.writeLocation,
      deleteLocation: writer.deleteLocation,
      onError: reason => errors.push(reason),
    });

    const incident = {
      id: fixtures.incidentId,
      lat: 14.65,
      lng: 121.06,
    };

    function emit(lat, lng, accuracy) {
      assert.equal(typeof gpsCallback, 'function');

      gpsCallback({
        timestamp: Date.now(),
        coords: {
          latitude: lat,
          longitude: lng,
          accuracy,
        },
      });
    }

    // No incident means no GPS watcher and no publication.
    controller.start([]);
    assert.equal(watchCount, 0);
    assert.equal((await locationRef.get()).exists, false);

    // Verified, assigned incident enables exactly one mock watcher.
    controller.start([incident]);
    assert.equal(watchCount, 1);

    // Poor GPS accuracy must not create a location.
    emit(14.6501, 121.0601, 80);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await locationRef.get()).exists, false);

    // Accurate nearby GPS must publish through the real writer.
    emit(14.6501, 121.0601, 8);

    await waitUntil(
      async () => (await locationRef.get()).exists,
      'Nearby accurate GPS did not create a location.',
    );

    const published = (await locationRef.get()).data();

    assert.deepEqual(
      Object.keys(published).sort(),
      [
        'stationId',
        'updatedBy',
        'incidentId',
        'location',
        'accuracy',
        'updatedAt',
      ].sort(),
    );

    assert.equal(published.stationId, 'TEST-STATION-001');
    assert.equal(published.updatedBy, account.uid);
    assert.equal(published.incidentId, fixtures.incidentId);
    assert.equal(published.accuracy, 8);
    assert.equal(published.location.latitude, 14.6501);
    assert.equal(published.location.longitude, 121.0601);
    assert.ok(published.updatedAt);

    // Leaving the 500 m area must delete the published location.
    emit(14.66, 121.07, 8);

    await waitUntil(
      async () => !(await locationRef.get()).exists,
      'Outside-area GPS did not delete the location.',
    );

    // Returning to the incident area permits publishing again.
    emit(14.6501, 121.0601, 8);

    await waitUntil(
      async () => (await locationRef.get()).exists,
      'Returning nearby did not republish.',
    );

    // Independently revoke the assignment in server-side Firestore.
    await fixtures.db
      .collection('incidents')
      .doc(fixtures.incidentId)
      .update({ assignedStationIds: [] });

    // Simulate the verified incident feed removing this incident.
    controller.updateIncidents([]);
    await controller.stopAndSettle();

    assert.equal(controller.active, false);
    assert.equal(clearCount, 1);
    assert.equal((await locationRef.get()).exists, false);

    // A callback captured from the obsolete watcher must do nothing.
    emit(14.6501, 121.0601, 8);
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.equal((await locationRef.get()).exists, false);
    assert.equal(watchCount, 1);
    assert.equal(
      errors.includes('location-write-failed'),
      false,
      `Unexpected write failure: ${errors.join(', ')}`,
    );
  } finally {
    if (controller) {
      try {
        await controller.stopAndSettle();
      } catch (error) {
        console.error('Controller cleanup failed:', error);
      }
    }

    globalThis.window = originalWindow;

    if (auth) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error('Test sign-out failed:', error);
      }
    }

    if (clientApp) {
      await deleteApp(clientApp);
    }

    if (fixtures) {
      await fixtures.cleanup();
    }

    await Promise.allSettled(
      generated.map(file => unlink(file)),
    );
  }
});