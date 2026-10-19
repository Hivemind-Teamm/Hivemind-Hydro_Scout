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
