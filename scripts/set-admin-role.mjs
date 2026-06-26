// set-admin-role.mjs
// One-off admin tool: set a user's RBAC role by email.
//
// Uses FIREBASE_SERVICE_ACCOUNT_KEY from .env.local (same credential the
// session API route uses), so no separate serviceAccountKey.json is needed.
//
// Usage:
//   node scripts/set-admin-role.mjs <email> [role]
//   node scripts/set-admin-role.mjs jabez.tan@ciit.edu.ph admin
//
// role defaults to "admin" and must be one of:
//   general | authorized | head | admin

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const VALID_ROLES = ["general", "authorized", "head", "admin"];

const email = process.argv[2];
const role = (process.argv[3] || "admin").toLowerCase();

if (!email) {
  console.error("Usage: node scripts/set-admin-role.mjs <email> [role]");
  process.exit(1);
}
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

// --- read FIREBASE_SERVICE_ACCOUNT_KEY out of .env.local ---
function readEnvValue(envText, key) {
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return null;
}

const envText = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || readEnvValue(envText, "FIREBASE_SERVICE_ACCOUNT_KEY");
if (!rawKey) {
  console.error("FIREBASE_SERVICE_ACCOUNT_KEY not found in environment or .env.local");
  process.exit(1);
}

const serviceAccount = JSON.parse(rawKey);
initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const db = getFirestore();

// --- look up the Auth account, then write the role onto its user doc ---
let uid;
try {
  const userRecord = await auth.getUserByEmail(email);
  uid = userRecord.uid;
} catch (err) {
  console.error(`No Firebase Auth account found for ${email}: ${err.message}`);
  process.exit(1);
}

const ref = db.collection("users").doc(uid);
const before = await ref.get();
const prevRole = before.exists ? before.data()?.role ?? "(none)" : "(no document)";

await ref.set(
  {
    email,
    role,
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log(`\n✅ ${email}`);
console.log(`   uid:  ${uid}`);
console.log(`   role: ${prevRole} → ${role}`);
console.log(`\nLog out and back in (or refresh) to pick up the new role.\n`);
process.exit(0);
