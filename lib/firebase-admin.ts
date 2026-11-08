
// lib/firebase-admin.ts
//
// Server-only Firebase Admin app, shared by every route that needs to verify
// auth (session creation + server routes that trust the session cookie).
//
// Credentials come from FIREBASE_SERVICE_ACCOUNT_KEY.
// Never import this module from a client component.

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";

type FirebaseTarget = "staging" | "production";

/**
 * Credential-free initialization is permitted only for the complete
 * local emulator setup.
 *
 * Never allow credential-free initialization against a real project.
 */
export function isFirebaseEmulatorMode(): boolean {
  return (
    process.env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099" &&
    process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8080" &&
    process.env.GCLOUD_PROJECT === "demo-hydro-scout-api" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Resolve the expected Firebase project for deployed environments.
 *
 * Staging must explicitly select staging.
 * Existing production deployments remain backward compatible.
 */
function expectedFirebaseProject(): string {
  const target = process.env.NEXT_PUBLIC_FIREBASE_TARGET;

  if (target === "staging") {
    return "hydro-scout-staging";
  }

  if (target === "production" || target === undefined) {
    return "hydro-scout";
  }

  throw new Error("Invalid Firebase deployment target.");
}

/**
 * Initialize Firebase Admin with verified project credentials.
 */
export function adminApp(): App {
  const existing = getApps();

  if (isFirebaseEmulatorMode()) {
    if (existing.length) {
      if (existing[0].options.projectId !== "demo-hydro-scout-api") {
        throw new Error(
          "Firebase emulator isolation failed: unexpected existing project.",
        );
      }

      return existing[0];
    }

    return initializeApp({
      projectId: "demo-hydro-scout-api",
    });
  }

  // Never allow an emulator host to be configured for a deployed app.
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.FIRESTORE_EMULATOR_HOST)
  ) {
    throw new Error(
      "Firebase isolation failed: emulator hosts configured in deployment.",
    );
  }

  const expectedProjectId = expectedFirebaseProject();

  if (existing.length) {
    if (existing[0].options.projectId !== expectedProjectId) {
      throw new Error(
        "Firebase Admin isolation failed: unexpected existing project.",
      );
    }

    return existing[0];
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See environment setup instructions.",
    );
  }

  const serviceAccount = JSON.parse(raw) as {
    project_id?: string;
    private_key?: string;
    client_email?: string;
  };

  /**
   * Verify that the service account belongs to the selected Firebase project.
   * Never silently fall back to production when staging is selected.
   */
  if (serviceAccount.project_id !== expectedProjectId) {
    throw new Error(
      `Firebase Admin isolation failed: expected ${expectedProjectId} service-account credentials.`,
    );
  }

  if (
    typeof serviceAccount.private_key !== "string" ||
    typeof serviceAccount.client_email !== "string"
  ) {
    throw new Error("Invalid Firebase service-account configuration.");
  }

  // Vercel may double-escape newline characters in environment variables.
  // Restore actual newlines in the private key.
  serviceAccount.private_key =
    serviceAccount.private_key.replace(/\\n/g, "\n");

  return initializeApp({
  credential: cert({
    projectId: expectedProjectId,
    clientEmail: serviceAccount.client_email,
    privateKey: serviceAccount.private_key,
  }),
  projectId: expectedProjectId,
});
}
