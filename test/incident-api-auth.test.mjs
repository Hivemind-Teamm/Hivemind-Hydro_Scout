import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test("Incident API rejects requests without a session", async () => {
  const response = await fetch(`${BASE_URL}/api/incidents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "active",
      jurisdictionVerified: true,
    }),
  });

  assert.equal(response.status, 401);

  const body = await response.json();
  assert.equal(body.error, "Authentication required.");
});

test("Incident API rejects a forged session cookie", async () => {
  const response = await fetch(`${BASE_URL}/api/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": "session=forged.invalid.session",
    },
    body: JSON.stringify({
      status: "active",
      jurisdictionVerified: true,
    }),
  });

  assert.equal(response.status, 401);

  const body = await response.json();
  assert.equal(
    body.error,
    "Authentication or server verification failed."
  );
});

const DEMO_PROJECT = "demo-hydro-scout-api";
const AUTH_EMULATOR = "http://127.0.0.1:9099";

async function testIncidentRole(account, expectedStatus) {
  const loginResponse = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${DEMO_PROJECT}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        returnSecureToken: true,
      }),
    }
  );

  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.localId, account.uid);

  const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: login.idToken }),
  });

  assert.equal(sessionResponse.status, 200);

  const sessionBody = await sessionResponse.json();
  assert.notEqual(sessionBody.fallback, true);

  const setCookie = sessionResponse.headers.get("set-cookie");
  assert.ok(setCookie, "Expected a Firebase session cookie.");

  const cookie = setCookie.split(";")[0];
  assert.ok(cookie.startsWith("session="));

  const response = await fetch(`${BASE_URL}/api/incidents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      status: "active",
      jurisdictionVerified: true,
    }),
  });

  assert.equal(response.status, expectedStatus);
}

test("Authenticated roles enforce incident API permissions", async () => {
  const base = new URL(BASE_URL);

  if (
    !["localhost", "127.0.0.1"].includes(base.hostname) ||
    base.port !== "3002" ||
    process.env.GCLOUD_PROJECT !== DEMO_PROJECT ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error("Exact local demo emulator configuration required.");
  }

  const { createIncidentFixtures } = await import(
    "./incident-api-fixtures.mjs"
  );

  const { accounts, cleanup } = await createIncidentFixtures();

  try {
    await testIncidentRole(accounts.admin, 501);
    await testIncidentRole(accounts.head, 403);
    await testIncidentRole(accounts.sub_admin, 501);
  } finally {
    await cleanup();
  }
});

test("Incident GET rejects requests without a session", async () => {
  const response = await fetch(`${BASE_URL}/api/incidents`, {
    method: "GET",
    cache: "no-store",
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0"
  );

  const body = await response.json();
  assert.equal(body.error, "Authentication required.");
  assert.equal(body.incidents, undefined);
});

test("Incident GET rejects a forged session cookie", async () => {
  const response = await fetch(`${BASE_URL}/api/incidents`, {
    method: "GET",
    headers: {
      Cookie: "session=forged.invalid.session",
    },
    cache: "no-store",
  });

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0"
  );

  const body = await response.json();
  assert.equal(body.error, "Incident feed verification failed.");
  assert.equal(body.incidents, undefined);
});

async function getIncidentTestCookie(account) {
  const loginResponse = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${DEMO_PROJECT}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        returnSecureToken: true,
      }),
    }
  );

  assert.equal(loginResponse.status, 200);

  const login = await loginResponse.json();
  assert.equal(login.localId, account.uid);

  const sessionResponse = await fetch(`${BASE_URL}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: login.idToken }),
  });

  assert.equal(sessionResponse.status, 200);

  const sessionBody = await sessionResponse.json();
  assert.notEqual(sessionBody.fallback, true);

  const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("session="));

  return cookie;
}

async function readIncidentFeed(cookie) {
  const response = await fetch(`${BASE_URL}/api/incidents`, {
    method: "GET",
    headers: { Cookie: cookie },
    cache: "no-store",
  });

  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0"
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

test("Incident GET enforces trusted station assignments", async () => {
  const base = new URL(BASE_URL);

  if (
    !["localhost", "127.0.0.1"].includes(base.hostname) ||
    base.port !== "3002" ||
    process.env.GCLOUD_PROJECT !== DEMO_PROJECT ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error("Exact local demo emulator configuration required.");
  }

  const { createIncidentFixtures } = await import(
    "./incident-api-fixtures.mjs"
  );

  const fixtures = await createIncidentFixtures();

  try {
    const {
      accounts,
      db,
      incidentId,
      otherIncidentId,
      resolvedIncidentId,
      invalidIncidentId,
    } = fixtures;

    const subCookie = await getIncidentTestCookie(accounts.sub_admin);
    const adminCookie = await getIncidentTestCookie(accounts.admin);
    const headCookie = await getIncidentTestCookie(accounts.head);

    // Administrative roles must not automatically receive a station feed.
    for (const cookie of [adminCookie, headCookie]) {
      const result = await readIncidentFeed(cookie);
      assert.equal(result.status, 403);
      assert.equal(result.body.incidents, undefined);
    }

    // Only the station's active, valid incident is returned.
    const initial = await readIncidentFeed(subCookie);

    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.incidents, [{
      id: incidentId,
      lat: 14.65,
      lng: 121.06,
    }]);

    assert.ok(
      !initial.body.incidents.some(i =>
        [otherIncidentId, resolvedIncidentId, invalidIncidentId]
          .includes(i.id)
      )
    );

    // Revoking the assignment removes the incident from a fresh GET.
    await db.collection("incidents").doc(incidentId).update({
      assignedStationIds: [],
    });

    const revoked = await readIncidentFeed(subCookie);
    assert.equal(revoked.status, 200);
    assert.deepEqual(revoked.body.incidents, []);

    // Reassignment restores access.
    await db.collection("incidents").doc(incidentId).update({
      assignedStationIds: ["TEST-STATION-001"],
    });

    const reassigned = await readIncidentFeed(subCookie);
    assert.deepEqual(reassigned.body.incidents, [{
      id: incidentId,
      lat: 14.65,
      lng: 121.06,
    }]);

    // Resolving the incident removes it from the active feed.
    await db.collection("incidents").doc(incidentId).update({
      status: "resolved",
    });

    const resolved = await readIncidentFeed(subCookie);
    assert.equal(resolved.status, 200);
    assert.deepEqual(resolved.body.incidents, []);

    // Losing the trusted station account also revokes feed access.
    await db
      .collection("stations")
      .doc("TEST-STATION-001")
      .collection("accounts")
      .doc(accounts.sub_admin.uid)
      .update({
        accountType: "general",
      });

    const noStation = await readIncidentFeed(subCookie);
    assert.equal(noStation.status, 403);
    assert.equal(noStation.body.incidents, undefined);
  } finally {
    await fixtures.cleanup();
  }
});

test("Incident GET rejects oversized assignment feeds", async () => {
  const base = new URL(BASE_URL);

  if (
    !["localhost", "127.0.0.1"].includes(base.hostname) ||
    base.port !== "3002" ||
    process.env.GCLOUD_PROJECT !== DEMO_PROJECT ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
    process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error("Exact local demo emulator configuration required.");
  }

  const { randomUUID } = await import("node:crypto");
  const { GeoPoint } = await import("firebase-admin/firestore");
  const { createIncidentFixtures } = await import(
    "./incident-api-fixtures.mjs"
  );

  const fixtures = await createIncidentFixtures();
  const temporaryIds = [];

  try {
    const cookie = await getIncidentTestCookie(fixtures.accounts.sub_admin);
    const collection = fixtures.db.collection("incidents");

    const batch = fixtures.db.batch();

    for (let i = 0; i < 101; i++) {
      const id = `incident-overflow-${randomUUID()}`;
      temporaryIds.push(id);

      batch.set(collection.doc(id), {
        status: "active",
        location: new GeoPoint(14.65, 121.06),
        assignedStationIds: ["TEST-STATION-001"],
      });
    }

    await batch.commit();

    const overflowing = await readIncidentFeed(cookie);

    assert.equal(overflowing.status, 503);
    assert.equal(
      overflowing.body.error,
      "Incident assignment feed exceeds supported limit."
    );
    assert.equal(overflowing.body.incidents, undefined);

    // Remove the temporary records and verify normal operation resumes.
    const removeBatch = fixtures.db.batch();

    for (const id of temporaryIds) {
      removeBatch.delete(collection.doc(id));
    }

    await removeBatch.commit();
    temporaryIds.length = 0;

    const recovered = await readIncidentFeed(cookie);

    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body.incidents, [{
      id: fixtures.incidentId,
      lat: 14.65,
      lng: 121.06,
    }]);
  } finally {
    try {
      if (temporaryIds.length > 0) {
        const cleanupBatch = fixtures.db.batch();
        const collection = fixtures.db.collection("incidents");

        for (const id of temporaryIds) {
          cleanupBatch.delete(collection.doc(id));
        }

        await cleanupBatch.commit();
      }
    } finally {
      await fixtures.cleanup();
    }
  }
});
