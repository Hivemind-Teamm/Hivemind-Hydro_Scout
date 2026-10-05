// seed-station-aor.mjs
//
// F1 Station Accounts + Area of Responsibility (AOR)
//
// Seeds placeholder fire-station/AOR definitions into Firestore.
//
// This script intentionally uses PLACEHOLDER barangay assignments.
// Replace them with the official station-to-barangay AOR list once
// that information has been confirmed.
//
// Firestore structure:
//
// stations/{stationId}
//   stationId: string
//   name: string
//   aorBarangays: string[]
//   placeholder: boolean
//   createdAt / updatedAt: Timestamp
//
// Safe to re-run:
//   - Station document IDs are deterministic.
//   - Writes use { merge: true }.
//   - Existing unrelated fields are preserved.
//
// IMPORTANT:
//   This script does NOT assign stationId/AOR data to real user
//   accounts. User assignment should be performed separately once
//   the actual station assignments are known.
//
// Run from the project root:
//
//   node scripts/seed-station-aor.mjs
//
// Or provide another Firebase service account:
//
//   GOOGLE_APPLICATION_CREDENTIALS="path/to/key.json"
//   node scripts/seed-station-aor.mjs

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';

import {
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore';

/* -------------------------------------------------------------------------- */
/* Paths                                                                      */
/* -------------------------------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVICE_ACCOUNT =
  process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
    : resolve(__dirname, 'serviceAccountKey.json');

/* -------------------------------------------------------------------------- */
/* Firestore                                                                  */
/* -------------------------------------------------------------------------- */

const STATIONS_COLLECTION = 'stations';

/* -------------------------------------------------------------------------- */
/* Placeholder F1 station / AOR data                                          */
/* -------------------------------------------------------------------------- */

/**
 * PLACEHOLDER DATA ONLY.
 *
 * Do not treat these barangay names as official BFP AOR assignments.
 *
 * Once the official AOR list is available, replace the values below while
 * keeping each stationId stable wherever possible.
 *
 * stationId is intended to become the stable identifier used by:
 *
 *   users/{uid}.stationId
 *
 * and downstream features such as F2 unit location.
 */
const STATIONS = [
  {
    stationId: 'station-001',
    name: 'Placeholder Fire Station 1',
    aorBarangays: [
      'PLACEHOLDER_BARANGAY_01',
      'PLACEHOLDER_BARANGAY_02',
      'PLACEHOLDER_BARANGAY_03',
    ],
  },

  {
    stationId: 'station-002',
    name: 'Placeholder Fire Station 2',
    aorBarangays: [
      'PLACEHOLDER_BARANGAY_04',
      'PLACEHOLDER_BARANGAY_05',
      'PLACEHOLDER_BARANGAY_06',
    ],
  },

  {
    stationId: 'station-003',
    name: 'Placeholder Fire Station 3',
    aorBarangays: [
      'PLACEHOLDER_BARANGAY_07',
      'PLACEHOLDER_BARANGAY_08',
      'PLACEHOLDER_BARANGAY_09',
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function validateStations(stations) {
  const stationIds = new Set();

  for (const station of stations) {
    if (
      typeof station.stationId !== 'string' ||
      !station.stationId.trim()
    ) {
      throw new Error('Every station must have a stationId.');
    }

    if (stationIds.has(station.stationId)) {
      throw new Error(
        `Duplicate stationId found: ${station.stationId}`,
      );
    }

    stationIds.add(station.stationId);

    if (
      typeof station.name !== 'string' ||
      !station.name.trim()
    ) {
      throw new Error(
        `Station ${station.stationId} must have a name.`,
      );
    }

    if (
      !Array.isArray(station.aorBarangays) ||
      station.aorBarangays.length === 0
    ) {
      throw new Error(
        `Station ${station.stationId} must have at least one AOR barangay.`,
      );
    }

    const seenBarangays = new Set();

    for (const barangay of station.aorBarangays) {
      if (
        typeof barangay !== 'string' ||
        !barangay.trim()
      ) {
        throw new Error(
          `Station ${station.stationId} contains an invalid barangay.`,
        );
      }

      const normalized = barangay.trim().toLowerCase();

      if (seenBarangays.has(normalized)) {
        throw new Error(
          `Station ${station.stationId} contains duplicate barangay "${barangay}".`,
        );
      }

      seenBarangays.add(normalized);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Firebase Admin initialization                                              */
/* -------------------------------------------------------------------------- */

async function initializeFirebase() {
  let serviceAccount;

  try {
    serviceAccount = JSON.parse(
      await readFile(SERVICE_ACCOUNT, 'utf8'),
    );
  } catch (error) {
    console.error(
      `Could not read Firebase service account:\n${SERVICE_ACCOUNT}`,
    );

    throw error;
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
    });
  }

  return getFirestore();
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

async function seedStationAor() {
  validateStations(STATIONS);

  const db = await initializeFirebase();

  console.log('');
  console.log('Hydro-Scout F1 Station/AOR seed');
  console.log('--------------------------------');
  console.log(
    `Service account: ${SERVICE_ACCOUNT}`,
  );
  console.log(
    `Stations to seed: ${STATIONS.length}`,
  );
  console.log('');

  const batch = db.batch();

  for (const station of STATIONS) {
    const stationId = station.stationId.trim();

    const aorBarangays = station.aorBarangays.map(
      (barangay) => barangay.trim(),
    );

    const ref = db
      .collection(STATIONS_COLLECTION)
      .doc(stationId);

    batch.set(
      ref,
      {
        stationId,

        name: station.name.trim(),

        aorBarangays,

        // Explicitly marks these records as temporary.
        placeholder: true,

        updatedAt: FieldValue.serverTimestamp(),

        // This may be overwritten on a re-run, which is acceptable for
        // placeholder seed data. Once stations become production records,
        // creation timestamps can be managed separately.
        createdAt: FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    );

    console.log(
      `Prepared ${stationId}: ${station.name}`,
    );

    console.log(
      `  AOR: ${aorBarangays.join(', ')}`,
    );
  }

  await batch.commit();

  console.log('');
  console.log(
    `Done. ${STATIONS.length} placeholder station/AOR records written to "${STATIONS_COLLECTION}".`,
  );

  console.log('');
  console.log(
    'NOTE: These are placeholder AOR assignments only.',
  );

  console.log(
    'Replace them with the official station/barangay assignments before production use.',
  );
}

/* -------------------------------------------------------------------------- */
/* Execute                                                                    */
/* -------------------------------------------------------------------------- */

try {
  await seedStationAor();
  process.exit(0);
} catch (error) {
  console.error('');
  console.error('Station/AOR seed failed.');
  console.error(error);
  process.exit(1);
}