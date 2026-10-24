// check-firebase-deploy.mjs
// Read-only drift check: compares the LIVE Firestore rules and composite
// indexes of the Firebase project with firestore.rules and
// firestore.indexes.json in this checkout. Vercel deploys app code only, so
// rules/indexes can silently fall behind (October 2026: hydrant updates were
// rejected because a rules change was committed but never deployed).
//
// Uses FIREBASE_SERVICE_ACCOUNT_KEY from the environment or .env.local.
//
// Usage:
//   npm run check:firebase
//
// Exit code 1 means drift. Deploy with:
//   npx firebase-tools deploy --only firestore:rules,firestore:indexes --project hydro-scout

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import { getSecurityRules } from "firebase-admin/security-rules";

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

const envText = await readFile(new URL("../.env.local", import.meta.url), "utf8").catch(() => "");
const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || readEnvValue(envText, "FIREBASE_SERVICE_ACCOUNT_KEY");
if (!rawKey) {
  console.error("FIREBASE_SERVICE_ACCOUNT_KEY not found in environment or .env.local");
  process.exit(1);
}

const serviceAccount = JSON.parse(rawKey);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
const credential = cert(serviceAccount);
const app = initializeApp({ credential });
const projectId = serviceAccount.project_id;

const normalize = (text) => text.replace(/\r/g, "").trim();
let drift = false;

// --- rules ---
const liveRuleset = await getSecurityRules(app).getFirestoreRuleset();
const liveRules = normalize(liveRuleset.source[0]?.content ?? "");
const repoRules = normalize(await readFile(new URL("../firestore.rules", import.meta.url), "utf8"));
if (liveRules === repoRules) {
  console.log(`rules:   OK (live ruleset published ${liveRuleset.createTime})`);
} else {
  drift = true;
  console.log(`rules:   DRIFT - live ruleset (published ${liveRuleset.createTime}) differs from firestore.rules`);
}

// --- composite indexes ---
const indexKey = (collectionGroup, queryScope, fields) =>
  `${collectionGroup} [${queryScope}] ` +
  fields
    .filter((f) => f.fieldPath !== "__name__")
    .map((f) => `${f.fieldPath}:${f.order ?? f.arrayConfig}`)
    .join(", ");

const { access_token } = await credential.getAccessToken();
const response = await fetch(
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/-/indexes`,
  { headers: { Authorization: `Bearer ${access_token}` } },
);
const live = new Set(
  response.ok
    ? ((await response.json()).indexes ?? []).map((i) =>
      indexKey(i.name.split("/collectionGroups/")[1].split("/")[0], i.queryScope, i.fields),
    )
    : [],
);
if (!response.ok) {
  drift = true;
  console.error(`indexes: could not list live indexes (HTTP ${response.status})`);
}
const repoIndexes = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
const missing = (repoIndexes.indexes ?? [])
  .map((i) => indexKey(i.collectionGroup, i.queryScope, i.fields))
  .filter((key) => !live.has(key));
if (missing.length) {
  drift = true;
  console.log("indexes: DRIFT - missing in Firebase:");
  for (const key of missing) console.log(`  - ${key}`);
} else if (response.ok) {
  console.log(`indexes: OK (${live.size} composite index(es) live)`);
}

if (drift) {
  console.log("\nDeploy with: npx firebase-tools deploy --only firestore:rules,firestore:indexes --project " + projectId);
  // exitCode, not process.exit(): exiting with sockets still closing crashes libuv on Windows.
  process.exitCode = 1;
}
