// test/rbac.test.mjs
//
// Automated verification of firestore.rules against the four-tier RBAC
// permission matrix. Runs against the Firebase Local Emulator Suite,
// never touches production data.
//
// Setup (one time):
//   npm i -D @firebase/rules-unit-testing
//
// Run:
//   firebase emulators:exec "node test/rbac.test.mjs"
//
// This starts the Firestore emulator, runs this script against it, prints
// pass/fail for every row of the permission matrix, then shuts down.

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "hydro-scout-rbac-test";

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

// --- seed data the rules will read via get() during evaluation ---
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();

  const users = [
    { uid: "sample-general", role: "general" },
    { uid: "sample-authorized", role: "authorized" },
    { uid: "sample-head", role: "head" },
    { uid: "sample-admin", role: "admin" },
  ];
  for (const u of users) {
    await db.collection("users").doc(u.uid).set({
      uid: u.uid,
      role: u.role,
      email: `${u.uid}@example.com`,
    });
  }

  await db.collection("hydrants").doc("HYD-001").set({
    lat: 14.653,
    lng: 121.068,
    status: "active",
    notes: "seed",
    lastMaintenanceDate: null,
    nextMaintenanceDate: null,
  });
});

// Each update test gets its own fresh document via this helper, so an
// earlier test's write can't make a later test's update look like a
// no-op (no-op updates produce an empty diff, which trivially passes
// any hasOnly() field check and would give a false PASS/FAIL).
let seedCounter = 0;
async function freshHydrant() {
  seedCounter += 1;
  const id = `SEED-${seedCounter}`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().collection("hydrants").doc(id).set({
      lat: 14.653,
      lng: 121.068,
      status: "active",
      notes: "seed",
      lastMaintenanceDate: null,
      nextMaintenanceDate: null,
    });
  });
  return id;
}

function ctxFor(uid) {
  return uid
    ? testEnv.authenticatedContext(uid)
    : testEnv.unauthenticatedContext();
}

let passed = 0;
let failed = 0;

async function check(label, promise, expectAllow) {
  try {
    if (expectAllow) {
      await assertSucceeds(promise);
    } else {
      await assertFails(promise);
    }
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${label}`);
    console.log(`        ${e.message.split("\n")[0]}`);
    failed++;
  }
}

console.log("\n=== Section 1: Reading hydrants ===");
for (const uid of ["sample-general", "sample-authorized", "sample-head", "sample-admin"]) {
  const db = ctxFor(uid).firestore();
  await check(`${uid} can read /hydrants/HYD-001`, db.collection("hydrants").doc("HYD-001").get(), true);
}
await check(
  "signed-out cannot read /hydrants/HYD-001",
  ctxFor(null).firestore().collection("hydrants").doc("HYD-001").get(),
  false
);

console.log("\n=== Section 2: Creating a new hydrant ===");
await check(
  "general cannot create hydrant",
  ctxFor("sample-general").firestore().collection("hydrants").doc("TEST-001").set({ lat: 0, lng: 0 }),
  false
);
await check(
  "authorized CAN create hydrant",
  ctxFor("sample-authorized").firestore().collection("hydrants").doc("TEST-002").set({ lat: 0, lng: 0 }),
  true
);
await check(
  "head cannot create hydrant",
  ctxFor("sample-head").firestore().collection("hydrants").doc("TEST-003").set({ lat: 0, lng: 0 }),
  false
);
await check(
  "admin CAN create hydrant",
  ctxFor("sample-admin").firestore().collection("hydrants").doc("TEST-004").set({ lat: 0, lng: 0 }),
  true
);

console.log("\n=== Section 3: Updating status (Authorized's scope) ===");
{
  const id1 = await freshHydrant();
  await check(`general cannot update status`, ctxFor("sample-general").firestore().collection("hydrants").doc(id1).update({ status: "damaged" }), false);

  const id2 = await freshHydrant();
  await check(`authorized CAN update status`, ctxFor("sample-authorized").firestore().collection("hydrants").doc(id2).update({ status: "damaged" }), true);

  const id3 = await freshHydrant();
  await check(`head cannot update status (wrong field scope)`, ctxFor("sample-head").firestore().collection("hydrants").doc(id3).update({ status: "damaged" }), false);

  const id4 = await freshHydrant();
  await check(`admin CAN update status`, ctxFor("sample-admin").firestore().collection("hydrants").doc(id4).update({ status: "damaged" }), true);
}

console.log("\n=== Section 4: Updating maintenance fields (Head's scope) ===");
{
  const id1 = await freshHydrant();
  await check(`authorized cannot update lastMaintenanceDate (wrong field scope)`, ctxFor("sample-authorized").firestore().collection("hydrants").doc(id1).update({ lastMaintenanceDate: "2026-06-17" }), false);

  const id2 = await freshHydrant();
  await check(`head CAN update lastMaintenanceDate`, ctxFor("sample-head").firestore().collection("hydrants").doc(id2).update({ lastMaintenanceDate: "2026-06-17" }), true);

  const id3 = await freshHydrant();
  await check(`admin CAN update lastMaintenanceDate`, ctxFor("sample-admin").firestore().collection("hydrants").doc(id3).update({ lastMaintenanceDate: "2026-06-17" }), true);
}

console.log("\n=== Section 5: Mixed-field update (should fail for non-Admin) ===");
{
  const id1 = await freshHydrant();
  await check(`authorized cannot mix status + lastMaintenanceDate`, ctxFor("sample-authorized").firestore().collection("hydrants").doc(id1).update({
    status: "damaged",
    lastMaintenanceDate: "2026-06-17",
  }), false);

  const id2 = await freshHydrant();
  await check(`head cannot mix status + lastMaintenanceDate`, ctxFor("sample-head").firestore().collection("hydrants").doc(id2).update({
    status: "damaged",
    lastMaintenanceDate: "2026-06-17",
  }), false);

  const id3 = await freshHydrant();
  await check(`admin CAN mix status + lastMaintenanceDate`, ctxFor("sample-admin").firestore().collection("hydrants").doc(id3).update({
    status: "damaged",
    lastMaintenanceDate: "2026-06-17",
  }), true);
}

console.log("\n=== Section 6: Deleting a hydrant ===");
for (const [uid, expect] of [
  ["sample-general", false],
  ["sample-authorized", false],
  ["sample-head", false],
  ["sample-admin", true],
]) {
  await check(
    `${uid} ${expect ? "CAN" : "cannot"} delete hydrant`,
    ctxFor(uid).firestore().collection("hydrants").doc("HYD-001").delete(),
    expect
  );
}

console.log("\n=== Section 7: Reports subcollection ===");
await check(
  "general can read reports",
  ctxFor("sample-general").firestore().collection("hydrants").doc("HYD-001").collection("reports").doc("r1").get(),
  true
);
await check(
  "authorized cannot create report",
  ctxFor("sample-authorized").firestore().collection("hydrants").doc("HYD-001").collection("reports").doc("r1").set({ note: "x" }),
  false
);
await check(
  "head CAN create report",
  ctxFor("sample-head").firestore().collection("hydrants").doc("HYD-001").collection("reports").doc("r2").set({ note: "x" }),
  true
);
await check(
  "admin CAN create report",
  ctxFor("sample-admin").firestore().collection("hydrants").doc("HYD-001").collection("reports").doc("r3").set({ note: "x" }),
  true
);

console.log("\n=== Section 8: Users collection access ===");
await check(
  "general can read own user doc",
  ctxFor("sample-general").firestore().collection("users").doc("sample-general").get(),
  true
);
await check(
  "general cannot read admin's user doc",
  ctxFor("sample-general").firestore().collection("users").doc("sample-admin").get(),
  false
);
await check(
  "admin can read any user doc",
  ctxFor("sample-admin").firestore().collection("users").doc("sample-general").get(),
  true
);
await check(
  "authorized cannot self-promote role",
  ctxFor("sample-authorized").firestore().collection("users").doc("sample-authorized").update({ role: "admin" }),
  false
);
await check(
  "admin CAN change another user's role",
  ctxFor("sample-admin").firestore().collection("users").doc("sample-general").update({ role: "head" }),
  true
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);

await testEnv.cleanup();
process.exit(failed > 0 ? 1 : 0);
