// seed-station-aor.mjs
//
// F1 Station Accounts + Area of Responsibility (AOR)
//
// Seeds verified BFP Station 4 substation/AOR definitions into Firestore.
//
// Contains the confirmed BFP Station 4 substation-to-barangay AOR list.
// Account assignments are managed separately.
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
/* BFP Station 4 substation / AOR data                                          */
/* -------------------------------------------------------------------------- */

/**
 * Confirmed BFP Station 4 substation AOR assignments.
 *
 * Keep station IDs stable after accounts have been assigned.
 *
 * stationId is intended to become the stable identifier used by:
 *
 *   users/{uid}.stationId
 *
 * and downstream features such as F2 unit location.
 */
const STATIONS = [
  {
    stationId: 'bfp-station-4-paligsahan',
    name: 'Paligsahan Substation',
    aorBarangays: [
      'Kalusugan',
      'Kristong Hari',
      'Paligsahan',
      'Roxas District',
    ],
  },
  {
    stationId: 'bfp-station-4-krus-na-ligas',
    name: 'Krus na Ligas Substation',
    aorBarangays: [
      'Krus na Ligas',
      'UP Campus',
      'UP Village',
      'Botocan',
      'Teachers Village East',
    ],
  },
  {
    stationId: 'bfp-station-4-central',
    name: 'Central Substation',
    aorBarangays: [
      'Central',
      'Old Capitol Site',
    ],
  },
  {
    stationId: 'bfp-station-4-laging-handa',
    name: 'Laging Handa Substation',
    aorBarangays: [
      'Kamuning',
      'Laging Handa',
      'Obrero',
      'Sacred Heart',
      'South Triangle',
    ],
  },
]

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

  if (!process.argv.includes('--apply')) {
    console.log('Hydro-Scout BFP Station 4 AOR preview');
    console.log('------------------------------------');

    for (const station of STATIONS) {
      console.log(station.stationId + ': ' + station.name);
      console.log('  AOR: ' + station.aorBarangays.join(', '));
    }

    console.log('');
    console.log('DRY RUN: No Firebase connection or database writes.');
    console.log('Use --apply to write these records.');
    return;
  }

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

    const existing = await ref.get();

    batch.set(
      ref,
      {
        stationId,
        name: station.name.trim(),
        aorBarangays,
        placeholder: false,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!existing.exists
          ? { createdAt: FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
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
    `Done. ${STATIONS.length} BFP substation/AOR records written to "${STATIONS_COLLECTION}".`,
  );

  console.log('');
  console.log(
    'BFP Station 4 substation AOR records applied.',
  );

  console.log(
    'Existing user account assignments were not modified.',
  );
}

/* -------------------------------------------------------------------------- */
/* Execute                                                                    */
/* -------------------------------------------------------------------------- */

export { STATIONS };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    await seedStationAor();
  } catch (error) {
    console.error('');
    console.error('Station/AOR seed failed.');
    console.error(error);
    process.exitCode = 1;
  }
}