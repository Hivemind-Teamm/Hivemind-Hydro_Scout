import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { STATIONS } from '../scripts/seed-station-aor.mjs';

const testEnv = await initializeTestEnvironment({
  projectId: 'hydro-scout-bfp-aor-test',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
  },
});

let passed = 0;
let failed = 0;

async function check(label, operation, allowed) {
  try {
    if (allowed) {
      await assertSucceeds(operation);
    } else {
      await assertFails(operation);
    }
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL  ${label}: ${error.message.split('\n')[0]}`);
    failed++;
  }
}

try {
  const allBarangays = STATIONS.flatMap((station) => station.aorBarangays);

  if (STATIONS.length !== 4 || allBarangays.length !== 16) {
    throw new Error('Expected four substations and 16 barangay assignments.');
  }

  if (new Set(allBarangays).size !== 16) {
    throw new Error('Duplicate barangay assignments detected.');
  }

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    for (const station of STATIONS) {
      await db.collection('users').doc(station.stationId).set({
        uid: station.stationId,
        role: 'authorized',
        stationId: station.stationId,
        aorBarangays: station.aorBarangays,
      });
    }

    for (let index = 0; index < allBarangays.length; index++) {
      await db.collection('hydrants').doc(`BFP-${index}`).set({
        barangay: allBarangays[index],
        operationalStatus: 'Operational',
        pressureStatus: 'Strong',
        notes: 'Emulator test hydrant',
      });
    }
  });

  console.log('\n=== BFP Station 4 AOR permission tests ===');

  for (const station of STATIONS) {
    const db = testEnv.authenticatedContext(station.stationId).firestore();

    for (let index = 0; index < allBarangays.length; index++) {
      const barangay = allBarangays[index];
      const allowed = station.aorBarangays.includes(barangay);

      await check(
        `${station.name}: ${barangay} (${allowed ? 'allowed' : 'denied'})`,
        db.collection('hydrants').doc(`BFP-${index}`).update({
          operationalStatus: 'Reduced Pressure',
        }),
        allowed,
      );
    }
  }

  console.log('\n=== BFP field protection ===');

  for (const station of STATIONS) {
    const db = testEnv.authenticatedContext(station.stationId).firestore();
    const index = allBarangays.indexOf(station.aorBarangays[0]);

    await check(
      `${station.name}: cannot change hydrant barangay`,
      db.collection('hydrants').doc(`BFP-${index}`).update({
        barangay: station.aorBarangays[0] === 'Central' ? 'Kamuning' : 'Central',
      }),
      false,
    );

    await check(
      `${station.name}: cannot change hydrant notes`,
      db.collection('hydrants').doc(`BFP-${index}`).update({
        notes: 'Unauthorized edit',
      }),
      false,
    );
  }

  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error('BFP AOR test setup failed:', error);
  process.exitCode = 1;
} finally {
  await testEnv.cleanup();
}
