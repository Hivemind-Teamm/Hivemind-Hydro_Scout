// lib/firebase-admin.ts
//
// Server-only Firebase Admin app, shared by every route that needs to verify
// auth (session creation + any server route that trusts the session cookie).
// Credentials come from FIREBASE_SERVICE_ACCOUNT_KEY in .env.local — never
// import this from a client component.

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";

type FirebaseTarget = "staging" | "production";

// Credential-free initialization is permitted only for the complete local
// emulator setup. Keeping this predicate strict prevents production from ever
// bypassing its Firebase Admin service-account credential.
export function isFirebaseEmulatorMode(): boolean {
  return (
    process.env.LOCAL_FIREBASE_EMULATORS === "1" &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099" &&
    process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8080" &&
    process.env.GCLOUD_PROJECT === "demo-hydro-scout-api" &&
    // Vercel must never be able to enter emulator mode, even if a deployment
    // environment variable is configured incorrectly.
    process.env.VERCEL !== "1"
  );
}

function expectedFirebaseProject(): string {
  const target = process.env.NEXT_PUBLIC_FIREBASE_TARGET as FirebaseTarget | undefined;
  if (target === "staging") return "hydro-scout-staging";
  if (target === "production" || target === undefined) return "hydro-scout";
  throw new Error("Invalid Firebase deployment target.");
}

export function adminApp(): App {
  const existing = getApps();

  // Allow credential-free initialization ONLY against both local emulators
  // using a Firebase demo project. Never enable this for production.
  const projectId = process.env.GCLOUD_PROJECT;
  if (isFirebaseEmulatorMode()) {
    if (existing.length && existing[0].options.projectId !== "demo-hydro-scout-api") {
      throw new Error("Firebase emulator isolation failed: unexpected existing project.");
    }
    if (existing.length) return existing[0];
    return initializeApp({ projectId });
  }

  if (process.env.VERCEL === "1" && (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new Error("Firebase isolation failed: emulator hosts configured in deployment.");
  }

  const expectedProjectId = expectedFirebaseProject();
  if (existing.length) {
    if (existing[0].options.projectId !== expectedProjectId) {
      throw new Error("Firebase Admin isolation failed: unexpected existing project.");
    }
    return existing[0];
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See .env.local setup instructions."
    );
  }
  const serviceAccount = JSON.parse(raw) as { project_id?: string; private_key?: string; client_email?: string };
  if (serviceAccount.project_id !== expectedProjectId) {
    throw new Error(`Firebase Admin isolation failed: expected ${expectedProjectId} service-account credentials.`);
  }
  if (typeof serviceAccount.private_key !== "string" || typeof serviceAccount.client_email !== "string") {
    throw new Error("Invalid Firebase service-account configuration.");
  }
  // Vercel double-escapes \n in env vars; restore actual newlines in the private key.
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return initializeApp({
    credential: cert({
      projectId: expectedProjectId,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    }),
    projectId: expectedProjectId,
  });
}
