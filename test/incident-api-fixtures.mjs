
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, GeoPoint } from "firebase-admin/firestore";

const PROJECT = "demo-hydro-scout-api";
const STATION_ID = "TEST-STATION-001";

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
      await db
        .collection("stations")
        .doc(STATION_ID)
        .collection("accounts")
        .doc(uid)
        .delete();

      await db.collection("stationAccountIndex").doc(uid).delete();
      await db.collection("users").doc(uid).delete();
      await auth.deleteUser(uid);
    }

    await db.collection("stations").doc(STATION_ID).delete();
    await deleteApp(app);
  }

  try {
    const accounts = {};

    await db.collection("stations").doc(STATION_ID).set({
      name: "Test Fire Station",
      station: "Test Fire Station",
      active: true,
      aorBarangays: ["TEST-BARANGAY-A"],
    });

    for (const role of ["admin", "head", "sub_admin"]) {
      const id = randomUUID();
      const uid = `incident-fixture-${id}`;
      const email = `incident-${id}@example.test`;
      const password = `Demo-${randomUUID()}!`;

      await auth.createUser({ uid, email, password });
      created.push(uid);

      if (role === "sub_admin") {
        // The name "sub_admin" is retained as a fixture key
        // for older tests. The account itself uses the new
        // verified station-account model.

        await db.collection("stationAccountIndex").doc(uid).set({
          stationId: STATION_ID,
        });

        await db
          .collection("stations")
          .doc(STATION_ID)
          .collection("accounts")
          .doc(uid)
          .set({
            uid,
            email,
            role: "head",
            accountType: "station",
            stationId: STATION_ID,
            station: "Test Fire Station",
            aorBarangays: ["TEST-BARANGAY-A"],
            active: true,
          });
      } else {
        await db.collection("users").doc(uid).set({
          uid,
          role,
          accountType: "person",
          email,
        });
      }

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
          assignedStationIds: [STATION_ID],
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
          assignedStationIds: [STATION_ID],
        },
      },
      {
        id: invalidIncidentId,
        data: {
          status: "active",
          location: "invalid-coordinates",
          assignedStationIds: [STATION_ID],
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
      stationId: STATION_ID,
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
