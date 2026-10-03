// seed-hydrants.mjs
//
// One-time / repeatable importer for Hydro-Scout hydrant data.
//
// F1 Station Accounts + AOR:
// Hydrant records now support an explicit `barangay` field.
//
// IMPORTANT:
// We do NOT infer barangay from the address. A neighborhood/address label
// such as "Diliman" is not necessarily an authoritative barangay value.
// If a hydrant has not yet been assigned a verified barangay, Firestore
// stores barangay as null.
//
// Safe to re-run:
//   - Hydrant document IDs are deterministic (HYD-001, HYD-002, ...).
//   - Writes use { merge: true }.
//   - Existing documents are updated rather than duplicated.
//
// Run from the project root:
//
//   node scripts/seed-hydrants.mjs
//
// A different Firebase service account may be supplied through:
//
//   GOOGLE_APPLICATION_CREDENTIALS="path/to/key.json"
//   node scripts/seed-hydrants.mjs

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
  GeoPoint,
  Timestamp,
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

const DATA_FILE = resolve(
  __dirname,
  'hydrant-data.json',
);

const COLLECTION = 'hydrants';

/* -------------------------------------------------------------------------- */
/* Firebase                                                                   */
/* -------------------------------------------------------------------------- */

async function initializeFirebase() {
  const serviceAccount = JSON.parse(
    await readFile(
      SERVICE_ACCOUNT,
      'utf8',
    ),
  );

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(
        serviceAccount,
      ),
    });
  }

  return getFirestore();
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function readBarangay(value) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    return null;
  }

  return value.trim();
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return Timestamp.fromDate(
    date,
  );
}

/* -------------------------------------------------------------------------- */
/* Firestore document mapping                                                 */
/* -------------------------------------------------------------------------- */

function toDoc(r) {
  return {
    recordNo:
      r.recordNo,

    sourceType:
      r.sourceType,

    location:
      r.latitude != null &&
      r.longitude != null
        ? new GeoPoint(
            r.latitude,
            r.longitude,
          )
        : null,

    address:
      r.address,

    nearestLandmark:
      r.nearestLandmark,

    // F1 Station Accounts + AOR.
    //
    // This must be an explicitly verified barangay.
    // We deliberately do NOT derive it from the address.
    barangay:
      readBarangay(
        r.barangay,
      ),

    operationalStatus:
      r.operationalStatus,

    pressureStatus:
      r.pressureStatus,

    waterCleanliness:
      r.waterCleanliness,

    hazards:
      Array.isArray(
        r.hazards,
      )
        ? r.hazards
        : [],

    hydrantColor:
      r.hydrantColor,

    outletCount:
      r.outletCount,

    outletSizeType:
      r.outletSizeType,

    adapterNeeded:
      r.adapterNeeded,

    keyWrenchNeeded:
      r.keyWrenchNeeded,

    ownershipJurisdiction:
      r.ownershipJurisdiction,

    inspector:
      r.inspector,

    dateInspected:
      toTimestamp(
        r.dateInspected,
      ),

    lastMaintenanceDate:
      toTimestamp(
        r.lastMaintenanceDate,
      ),

    nextMaintenanceDate:
      toTimestamp(
        r.nextMaintenanceDate,
      ),

    photoFilename:
      r.photoFilename,

    photoUrl:
      r.photoUrl,

    additionalPhotos:
      Array.isArray(
        r.additionalPhotos,
      )
        ? r.additionalPhotos
        : [],

    notes:
      r.notes,

    gpsComplete:
      r.gpsComplete,

    followUpNeeded:
      r.followUpNeeded,

    importedAt:
      FieldValue.serverTimestamp(),
  };
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

async function seedHydrants() {
  const db =
    await initializeFirebase();

  const records =
    JSON.parse(
      await readFile(
        DATA_FILE,
        'utf8',
      ),
    );

  if (
    !Array.isArray(records)
  ) {
    throw new Error(
      'hydrant-data.json must contain an array.',
    );
  }

  console.log('');
  console.log(
    'Hydro-Scout hydrant seed',
  );

  console.log(
    '-------------------------',
  );

  console.log(
    `Hydrants found: ${records.length}`,
  );

  const tagged =
    records.filter(
      (r) =>
        readBarangay(
          r.barangay,
        ) !== null,
    ).length;

  const untagged =
    records.length -
    tagged;

  console.log(
    `Barangay tagged: ${tagged}`,
  );

  console.log(
    `Barangay unassigned: ${untagged}`,
  );

  console.log('');

  const CHUNK = 450;

  let written = 0;

  for (
    let i = 0;
    i < records.length;
    i += CHUNK
  ) {
    const batch =
      db.batch();

    const chunk =
      records.slice(
        i,
        i + CHUNK,
      );

    for (
      const r of chunk
    ) {
      if (
        typeof r.hydrantId !==
          'string' ||
        !r.hydrantId.trim()
      ) {
        throw new Error(
          `Hydrant record at index ${i + written} has no valid hydrantId.`,
        );
      }

      const ref =
        db
          .collection(
            COLLECTION,
          )
          .doc(
            r.hydrantId.trim(),
          );

      batch.set(
        ref,
        toDoc(r),
        {
          merge: true,
        },
      );

      written++;
    }

    await batch.commit();

    console.log(
      `Committed ${Math.min(
        i + CHUNK,
        records.length,
      )} / ${records.length}`,
    );
  }

  console.log('');

  console.log(
    `Done. ${written} hydrants written to "${COLLECTION}".`,
  );

  if (untagged > 0) {
    console.log('');
    console.log(
      `${untagged} hydrant(s) still have barangay = null.`,
    );

    console.log(
      'Add verified barangay values to hydrant-data.json when they become available.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Execute                                                                    */
/* -------------------------------------------------------------------------- */

try {
  await seedHydrants();
  process.exit(0);
} catch (error) {
  console.error('');
  console.error(
    'Hydrant seed failed.',
  );

  console.error(error);

  process.exit(1);
}