// test/aor-rules.test.mjs
//
// F1 Station Accounts + AOR
// Firestore Security Rules verification.
//
// Acceptance criteria:
//   1. A user can edit hydrant status inside their own AOR.
//   2. A user cannot edit hydrant status outside their AOR.
//   3. Hydrants remain publicly viewable.
//
// Additional defensive checks verify that AOR permission cannot be used
// to change barangay or unrelated hydrant fields.

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const PROJECT_ID = "hydro-scout-aor-test";

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

// ---------------------------------------------------------------------
// Seed users and hydrants without applying security rules.
// ---------------------------------------------------------------------

await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();

  await db.collection("users").doc("station-a-user").set({
    uid: "station-a-user",
    role: "authorized",
    stationId: "STATION-A",
    aorBarangays: [
      "Barangay Bagong Pag-asa",
      "Barangay Bago Bantay",
    ],
  });

  await db.collection("users").doc("station-b-user").set({
    uid: "station-b-user",
    role: "authorized",
    stationId: "STATION-B",
    aorBarangays: [
      "Barangay Holy Spirit",
    ],
  });

  await db.collection("users").doc("head-user").set({
    uid: "head-user",
    role: "head",
    stationId: null,
    aorBarangays: [],
  });

  await db.collection("users").doc("admin-user").set({
    uid: "admin-user",
    role: "admin",
    stationId: null,
    aorBarangays: [],
  });

  await db.collection("hydrants").doc("HYD-A").set({
    barangay: "Barangay Bagong Pag-asa",
    operationalStatus: "Operational",
    pressureStatus: "Strong",
    notes: "Station A hydrant",
  });

  await db.collection("hydrants").doc("HYD-B").set({
    barangay: "Barangay Holy Spirit",
    operationalStatus: "Operational",
    pressureStatus: "Strong",
    notes: "Station B hydrant",
  });
});

function dbFor(uid) {
  return uid
    ? testEnv.authenticatedContext(uid).firestore()
    : testEnv.unauthenticatedContext().firestore();
}

let passed = 0;
let failed = 0;

async function check(label, operation, shouldSucceed) {
  try {
    if (shouldSucceed) {
      await assertSucceeds(operation);
    } else {
      await assertFails(operation);
    }

    console.log(`  PASS  ${label}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${label}`);
    console.log(`        ${error.message.split("\n")[0]}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------
// Required acceptance test 1: own AOR can edit.
// ---------------------------------------------------------------------

console.log("\n=== AOR status editing ===");

await check(
  "own AOR can edit operationalStatus",
  dbFor("station-a-user")
    .collection("hydrants")
    .doc("HYD-A")
    .update({
      operationalStatus: "Out of Service",
    }),
  true
);

// ---------------------------------------------------------------------
// Required acceptance test 2: other AOR is blocked.
// ---------------------------------------------------------------------

await check(
  "other AOR is blocked from editing operationalStatus",
  dbFor("station-a-user")
    .collection("hydrants")
    .doc("HYD-B")
    .update({
      operationalStatus: "Out of Service",
    }),
  false
);

// ---------------------------------------------------------------------
// Required acceptance test 3: all can view.
// Current application behavior intentionally allows public hydrant reads.
// ---------------------------------------------------------------------

console.log("\n=== Hydrant visibility ===");

await check(
  "own-AOR user can view hydrant",
  dbFor("station-a-user")
    .collection("hydrants")
    .doc("HYD-A")
    .get(),
  true
);

await check(
  "other-AOR user can view hydrant",
  dbFor("station-a-user")
    .collection("hydrants")
    .doc("HYD-B")
    .get(),
  true
);

await check(
  "head can view hydrant",
  dbFor("head-user")
    .collection("hydrants")
    .doc("HYD-A")
    .get(),
  true
);

await check(
  "admin can view hydrant",
  dbFor("admin-user")
    .collection("hydrants")
    .doc("HYD-A")
    .get(),
  true
);

await check(
  "signed-out public user can view hydrant",
  dbFor(null)
    .collection("hydrants")
    .doc("HYD-A")
    .get(),
  true
);

// ---------------------------------------------------------------------
// Defensive tests.
// ---------------------------------------------------------------------

console.log("\n=== AOR write boundaries ===");

await check(
  "AOR user cannot change hydrant barangay",
  dbFor("station-a-user")
    .collection("hydrants")
    .doc("HYD-A")
    .update({
      barangay: "Barangay Holy Spirit",
    }),
  false
);

await check(
  "AOR user cannot change unrelated hydrant fields",
  dbFor("station-a-user")
    .collection("hydrants")
    .doc("HYD-A")
    .update({
      notes: "Unauthorized notes edit",
    }),
  false
);

await check(
  "AOR user cannot combine status with unrelated fields",
  dbFor("station-a-user")
    .collection("hydrants")
    .doc("HYD-A")
    .update({
      operationalStatus: "Reduced Pressure",
      notes: "Unauthorized notes edit",
    }),
  false
);

// ---------------------------------------------------------------------
// Existing elevated permissions remain intact.
// ---------------------------------------------------------------------

console.log("\n=== Existing elevated permissions ===");

await check(
  "head retains approved hydrant update permission",
  dbFor("head-user")
    .collection("hydrants")
    .doc("HYD-B")
    .update({
      operationalStatus: "Reduced Pressure",
    }),
  true
);

await check(
  "admin retains unrestricted hydrant update permission",
  dbFor("admin-user")
    .collection("hydrants")
    .doc("HYD-B")
    .update({
      notes: "Admin update",
    }),
  true
);

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);

await testEnv.cleanup();

process.exit(failed > 0 ? 1 : 0);