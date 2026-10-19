import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = "demo-hydro-scout-api";

export async function createIncidentFixtures() {
  if (
    process.env.GCLOUD_PROJECT !== PROJECT ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error("Exact local demo emulator configuration required.");
  }

  const app = initializeApp(
    { projectId: PROJECT },
    `incident-fixture-${randomUUID()}`
  );

  const auth = getAuth(app);
  const db = getFirestore(app);
  const created = [];

  async function cleanup() {
    for (const uid of created.reverse()) {
      await db.collection("users").doc(uid).delete();
      await auth.deleteUser(uid);
    }
    await deleteApp(app);
  }

  try {
    const accounts = {};

    for (const role of ["admin", "head", "sub_admin"]) {
      const id = randomUUID();
      const uid = `incident-fixture-${id}`;
      const email = `incident-${id}@example.test`;
      const password = `Demo-${randomUUID()}!`;

      await auth.createUser({ uid, email, password });
      created.push(uid);

      await db.collection("users").doc(uid).set({
        role,
        email,
        ...(role === "sub_admin"
          ? {
              accountType: "station",
              stationId: "TEST-STATION-001",
              aorBarangays: ["TEST-BARANGAY-A"],
            }
          : {}),
      });

      accounts[role] = { uid, email, password };
    }

    return { accounts, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Fixture setup and cleanup both failed."
      );
    }
    throw error;
  }
}
