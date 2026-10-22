import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, GeoPoint } from "firebase-admin/firestore";

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
  const incidentIds = [];

  async function cleanup() {
    for (const incidentId of incidentIds.reverse()) {
      await db.collection("incidents").doc(incidentId).delete();
    }

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

    const incidentId = `incident-fixture-${randomUUID()}`;
    const otherIncidentId = `incident-fixture-${randomUUID()}`;
    const resolvedIncidentId = `incident-fixture-${randomUUID()}`;
    const invalidIncidentId = `incident-fixture-${randomUUID()}`;

    const fixtures = [
      {
        id: incidentId,
        data: {
          status: "active",
          location: new GeoPoint(14.65, 121.06),
          assignedStationIds: ["TEST-STATION-001"],
        },
      },
      {
        id: otherIncidentId,
        data: {
          status: "active",
          location: new GeoPoint(14.66, 121.07),
          assignedStationIds: ["OTHER-STATION"],
        },
      },
      {
        id: resolvedIncidentId,
        data: {
          status: "resolved",
          location: new GeoPoint(14.67, 121.08),
          assignedStationIds: ["TEST-STATION-001"],
        },
      },
      {
        id: invalidIncidentId,
        data: {
          status: "active",
          location: "invalid-coordinates",
          assignedStationIds: ["TEST-STATION-001"],
        },
      },
    ];

    for (const fixture of fixtures) {
      await db.collection("incidents").doc(fixture.id).set(fixture.data);
      incidentIds.push(fixture.id);
    }

    return {
      accounts,
      cleanup,
      db,
      incidentId,
      otherIncidentId,
      resolvedIncidentId,
      invalidIncidentId,
    };
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
