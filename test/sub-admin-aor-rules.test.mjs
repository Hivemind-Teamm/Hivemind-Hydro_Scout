import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";

const testEnv = await initializeTestEnvironment({
  projectId: "hydro-scout-sub-admin-aor-test",
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.collection("users").doc("sub-admin-laging-handa").set({
      uid: "sub-admin-laging-handa",
      role: "sub_admin",
      accountType: "station",
      stationId: "STATION-LAGING-HANDA",
      aorBarangays: ["Barangay Laging Handa"],
    });

    await db.collection("hydrants").doc("HYD-LAGING-HANDA").set({
      barangay: "Barangay Laging Handa",
      operationalStatus: "Operational",
      pressureStatus: "Strong",
    });

    await db.collection("hydrants").doc("HYD-OUTSIDE-AOR").set({
      barangay: "Barangay Holy Spirit",
      operationalStatus: "Operational",
      pressureStatus: "Strong",
    });
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.collection("hydrants").doc("HYD-LAGING-HANDA")
      .collection("reports").doc("REPORT-EDIT-IN").set({
        note: "Original inside-AOR report",
        createdBy: "another-user",
      });

    await db.collection("hydrants").doc("HYD-OUTSIDE-AOR")
      .collection("reports").doc("REPORT-EDIT-OUT").set({
        note: "Original outside-AOR report",
        createdBy: "another-user",
      });
  });
  const db = testEnv
    .authenticatedContext("sub-admin-laging-handa")
    .firestore();

  let passed = 0;
  let failed = 0;

  async function check(label, operation, allowed) {
    try {
      if (allowed) await assertSucceeds(operation);
      else await assertFails(operation);

      console.log(`PASS ${label}`);
      passed++;
    } catch (error) {
      console.error(`FAIL ${label}: ${error.message}`);
      failed++;
    }
  }

  await check(
    "Sub Admin can edit pressure within assigned AOR",
    db.collection("hydrants")
      .doc("HYD-LAGING-HANDA")
      .update({ pressureStatus: "Low" }),
    true
  );

  await check(
    "Sub Admin cannot edit pressure outside assigned AOR",
    db.collection("hydrants")
      .doc("HYD-OUTSIDE-AOR")
      .update({ pressureStatus: "Low" }),
    false
  );

  await check(
    "Sub Admin cannot reassign an outside-AOR hydrant to Laging Handa",
    db.collection("hydrants")
      .doc("HYD-OUTSIDE-AOR")
      .update({ barangay: "Barangay Laging Handa" }),
    false
  );
  await check(
    "Sub Admin can create hydrant report within assigned AOR",
    db.collection("hydrants")
      .doc("HYD-LAGING-HANDA")
      .collection("reports")
      .doc("REPORT-001")
      .set({ note: "Inspection completed" }),
    true
  );
  await check(
    "Sub Admin cannot create hydrant report outside assigned AOR",
    db.collection("hydrants")
      .doc("HYD-OUTSIDE-AOR")
      .collection("reports")
      .doc("REPORT-OUTSIDE")
      .set({ note: "Unauthorized inspection" }),
    false
  );
  await check(
    "Sub Admin can edit existing report within assigned AOR",
    db.collection("hydrants").doc("HYD-LAGING-HANDA")
      .collection("reports").doc("REPORT-EDIT-IN")
      .update({ note: "Reviewed by Sub Admin" }),
    true
  );

  await check(
    "Sub Admin cannot edit existing report outside assigned AOR",
    db.collection("hydrants").doc("HYD-OUTSIDE-AOR")
      .collection("reports").doc("REPORT-EDIT-OUT")
      .update({ note: "Unauthorized change" }),
    false
  );

  await check(
    "Sub Admin can delete existing report within assigned AOR",
    db.collection("hydrants").doc("HYD-LAGING-HANDA")
      .collection("reports").doc("REPORT-EDIT-IN")
      .delete(),
    true
  );

  await check(
    "Sub Admin cannot delete existing report outside assigned AOR",
    db.collection("hydrants").doc("HYD-OUTSIDE-AOR")
      .collection("reports").doc("REPORT-EDIT-OUT")
      .delete(),
    false
  );
  await check(
    "Sub Admin cannot change hydrant barangay inside assigned AOR",
    db.collection("hydrants").doc("HYD-LAGING-HANDA")
      .update({ barangay: "Barangay Holy Spirit" }),
    false
  );

  await check(
    "Sub Admin cannot combine approved and protected hydrant fields",
    db.collection("hydrants").doc("HYD-LAGING-HANDA")
      .update({
        pressureStatus: "Low",
        barangay: "Barangay Holy Spirit",
      }),
    false
  );

  await check(
    "Sub Admin cannot delete hydrant inside assigned AOR",
    db.collection("hydrants").doc("HYD-LAGING-HANDA")
      .delete(),
    false
  );
  await check(
    "Sub Admin cannot promote own role to admin",
    db.collection("users").doc("sub-admin-laging-handa")
      .update({ role: "admin" }),
    false
  );

  await check(
    "Sub Admin cannot change assigned station",
    db.collection("users").doc("sub-admin-laging-handa")
      .update({ stationId: "STATION-HOLY-SPIRIT" }),
    false
  );

  await check(
    "Sub Admin cannot expand own AOR",
    db.collection("users").doc("sub-admin-laging-handa")
      .update({
        aorBarangays: ["Barangay Laging Handa", "Barangay Holy Spirit"],
      }),
    false
  );
  await check(
    "Sub Admin cannot create hydrant using self-declared AOR",
    db.collection("hydrants").doc("HYD-UNVERIFIED")
      .set({
        barangay: "Barangay Laging Handa",
        operationalStatus: "Operational",
        pressureStatus: "Strong",
      }),
    false
  );
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);

  if (failed) process.exitCode = 1;
} finally {
  await testEnv.cleanup();
}
