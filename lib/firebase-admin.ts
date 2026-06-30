// lib/firebase-admin.ts
//
// Server-only Firebase Admin app, shared by every route that needs to verify
// auth (session creation + any server route that trusts the session cookie).
// Credentials come from FIREBASE_SERVICE_ACCOUNT_KEY in .env.local — never
// import this from a client component.

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";

export function adminApp(): App {
  const existing = getApps();
  if (existing.length) return existing[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See .env.local setup instructions."
    );
  }
  const serviceAccount = JSON.parse(raw);
  // Vercel double-escapes \n in env vars; restore actual newlines in the private key.
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  return initializeApp({ credential: cert(serviceAccount) });
}
