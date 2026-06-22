// seed-hydrants.mjs
// One-time importer: pushes the cleaned hydrant data into Firestore.
//
// Setup:
//   npm i firebase-admin
//   Download your service account key from
//     Firebase Console > Project Settings > Service accounts > Generate new private key
//   Save it next to this script as serviceAccountKey.json  (or point the env var at it)
//
// Run:
//   node seed-hydrants.mjs
//
// Safe to re-run: doc IDs are deterministic (HYD-001…) and writes use { merge: true },
// so a second run UPDATES the same docs instead of creating duplicates.

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import {
  getFirestore,
  GeoPoint,
  Timestamp,
  FieldValue,
} from "firebase-admin/firestore";

const SERVICE_ACCOUNT =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json";
const DATA_FILE = "./hydrant-data.json";
const COLLECTION = "hydrants";

// --- init ---
const serviceAccount = JSON.parse(await readFile(SERVICE_ACCOUNT, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const records = JSON.parse(await readFile(DATA_FILE, "utf8"));

// --- shape one Firestore document ---
function toDoc(r) {
  return {
    recordNo: r.recordNo,
    sourceType: r.sourceType,

    // Native GeoPoint — clean in the console + ready for geo-queries later.
    // Mapbox reads it as [longitude, latitude] (see read snippet in the chat).
    location:
      r.latitude != null && r.longitude != null
        ? new GeoPoint(r.latitude, r.longitude)
        : null,

    address: r.address,
    nearestLandmark: r.nearestLandmark,

    operationalStatus: r.operationalStatus, // Operational | Reduced Pressure | Out of Service
    pressureStatus: r.pressureStatus,
    waterCleanliness: r.waterCleanliness,
    hazards: r.hazards, // array -> use array-contains in queries

    hydrantColor: r.hydrantColor,
    outletCount: r.outletCount,
    outletSizeType: r.outletSizeType,
    adapterNeeded: r.adapterNeeded,
    keyWrenchNeeded: r.keyWrenchNeeded,
    ownershipJurisdiction: r.ownershipJurisdiction,

    inspector: r.inspector,
    dateInspected: r.dateInspected
      ? Timestamp.fromDate(new Date(r.dateInspected))
      : null,
    lastMaintenanceDate: r.lastMaintenanceDate
      ? Timestamp.fromDate(new Date(r.lastMaintenanceDate))
      : null,
    nextMaintenanceDate: r.nextMaintenanceDate
      ? Timestamp.fromDate(new Date(r.nextMaintenanceDate))
      : null,

    // Photos are still .HEIC filenames from the field. photoUrl stays null
    // until you upload to Cloudinary and write the secure URL back here.
    photoFilename: r.photoFilename,
    photoUrl: r.photoUrl,
    additionalPhotos: r.additionalPhotos,

    notes: r.notes,
    gpsComplete: r.gpsComplete,
    followUpNeeded: r.followUpNeeded,

    importedAt: FieldValue.serverTimestamp(),
  };
}

// --- batched writes (Firestore caps a batch at 500 ops; chunk at 450) ---
const CHUNK = 450;
let written = 0;
for (let i = 0; i < records.length; i += CHUNK) {
  const batch = db.batch();
  for (const r of records.slice(i, i + CHUNK)) {
    const ref = db.collection(COLLECTION).doc(r.hydrantId); // e.g. HYD-001
    batch.set(ref, toDoc(r), { merge: true });
    written++;
  }
  await batch.commit();
  console.log(`Committed ${Math.min(i + CHUNK, records.length)} / ${records.length}`);
}

console.log(`\n✅ Done. ${written} hydrants written to "${COLLECTION}".`);
process.exit(0);
