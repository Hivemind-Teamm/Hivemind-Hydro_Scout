// seed-users.mjs
// One-time importer: creates sample users in Firestore with RBAC roles.
//
// Setup:
//   Uses the same serviceAccountKey.json already sitting next to seed-hydrants.mjs
//
// Run:
//   node seed-users.mjs
//
// Safe to re-run: doc IDs are deterministic and writes use { merge: true },
// so a second run UPDATES the same docs instead of creating duplicates.
//
// NOTE: these are placeholder/sample users with fake UIDs, NOT real Firebase
// Auth accounts. Once you build the login flow, real users will get their
// own document here keyed by their actual Firebase Auth UID — see the
// "users/{uid}" pattern in the schema doc. This script just gets the
// collection structure into Firestore now so RBAC logic has something
// to read against while you build the rest.

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  FieldValue,
} from "firebase-admin/firestore";

const SERVICE_ACCOUNT =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json";
const COLLECTION = "users";

// --- init ---
const serviceAccount = JSON.parse(await readFile(SERVICE_ACCOUNT, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// --- sample users, one per role ---
const records = [
  {
    uid: "sample-admin",
    email: "admin@example.com",
    displayName: "Sample Admin",
    role: "admin",
  },
  {
    uid: "sample-responder",
    email: "responder@example.com",
    displayName: "Sample Responder",
    role: "responder",
  },
  {
    uid: "sample-viewer",
    email: "viewer@example.com",
    displayName: "Sample Viewer",
    role: "viewer",
  },
];

function toDoc(r) {
  return {
    uid: r.uid,
    email: r.email,
    displayName: r.displayName,
    role: r.role, // "admin" | "responder" | "viewer"
    createdAt: FieldValue.serverTimestamp(),
    lastLoginAt: null,
  };
}

// --- batched writes ---
const batch = db.batch();
for (const r of records) {
  const ref = db.collection(COLLECTION).doc(r.uid);
  batch.set(ref, toDoc(r), { merge: true });
}
await batch.commit();

console.log(`\n✅ Done. ${records.length} users written to "${COLLECTION}".`);
process.exit(0);
