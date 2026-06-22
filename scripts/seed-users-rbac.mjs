// seed-users.mjs
// One-time importer: creates sample users in Firestore with the four-tier RBAC roles.
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
// Auth accounts. Once the login flow is built, real users will get their own
// document here keyed by their actual Firebase Auth UID. This script just
// gets the four role values into Firestore now so the security rules have
// real documents to test against.
//
// Role values MUST exactly match what firestore.rules checks for:
//   'general' | 'authorized' | 'head' | 'admin'

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const SERVICE_ACCOUNT =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "./serviceAccountKey.json";
const COLLECTION = "users";

// --- init ---
const serviceAccount = JSON.parse(await readFile(SERVICE_ACCOUNT, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// --- one sample user per tier ---
const records = [
  {
    uid: "sample-general",
    email: "general@example.com",
    displayName: "Sample General User",
    role: "general",
  },
  {
    uid: "sample-authorized",
    email: "authorized@example.com",
    displayName: "Sample Authorized User",
    role: "authorized",
  },
  {
    uid: "sample-head",
    email: "head@example.com",
    displayName: "Sample Head",
    role: "head",
  },
  {
    uid: "sample-admin",
    email: "admin@example.com",
    displayName: "Sample Admin",
    role: "admin",
  },
];

function toDoc(r) {
  return {
    uid: r.uid,
    email: r.email,
    displayName: r.displayName,
    role: r.role, // 'general' | 'authorized' | 'head' | 'admin'
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
