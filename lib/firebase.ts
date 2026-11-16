
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

/**
 * Production Firebase configuration.
 * Used only when the deployment explicitly selects production,
 * or when preserving the existing production deployment behavior.
 */
const productionFirebaseConfig = {
  apiKey: "AIzaSyD343gpPDZEUGzzVmIEqDCHQaxMlueWIpE",
  authDomain: "hydro-scout.firebaseapp.com",
  projectId: "hydro-scout",
  storageBucket: "hydro-scout.firebasestorage.app",
  messagingSenderId: "626033823119",
  appId: "1:626033823119:web:b0dfa6b41fadd348830ffa",
  measurementId: "G-7JQTPTSKD5",
};

/**
 * Staging Firebase configuration.
 *
 * The API key is supplied through the staging deployment's
 * environment variables.
 *
 * This configuration must never fall back to production.
 */
const stagingFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_STAGING_FIREBASE_API_KEY,
  authDomain: "hydro-scout-staging.firebaseapp.com",
  projectId: "hydro-scout-staging",
  storageBucket: "hydro-scout-staging.firebasestorage.app",
  messagingSenderId: "995672859034",
  appId: "1:995672859034:web:f420abc3e145fca8085a23",
  measurementId: "G-6FBSCKYLWS",
};

/**
 * Development is emulator-only.
 * Never use a real Firebase project while running Next.js
 * in development mode.
 */
const isLocalDevelopment = process.env.NODE_ENV === "development";

const firebaseTarget = process.env.NEXT_PUBLIC_FIREBASE_TARGET;

if (
  !isLocalDevelopment &&
  firebaseTarget !== undefined &&
  firebaseTarget !== "staging" &&
  firebaseTarget !== "production"
) {
  throw new Error("Invalid Firebase deployment target.");
}

if (
  !isLocalDevelopment &&
  firebaseTarget === "staging" &&
  !stagingFirebaseConfig.apiKey
) {
  throw new Error(
    "Missing NEXT_PUBLIC_STAGING_FIREBASE_API_KEY for staging.",
  );
}

/**
 * Select Firebase based on the application environment.
 *
 * Local development -> Firebase emulators
 * Staging           -> hydro-scout-staging
 * Production        -> hydro-scout
 */
export const firebaseConfig = isLocalDevelopment
  ? {
      apiKey: "demo-emulator-only-key",
      authDomain: "localhost",
      projectId: "demo-hydro-scout-api",
      storageBucket: "demo-hydro-scout-api.appspot.com",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:demo-hydro-scout-api",
    }
  : firebaseTarget === "staging"
    ? stagingFirebaseConfig
    : productionFirebaseConfig;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * Verify that the Firebase app belongs to the intended project.
 * Fail rather than silently using a different Firebase project.
 */
if (
  isLocalDevelopment &&
  app.options.projectId !== "demo-hydro-scout-api"
) {
  throw new Error(
    "Development Firebase isolation failed: unexpected project.",
  );
}

if (
  !isLocalDevelopment &&
  firebaseTarget === "staging" &&
  app.options.projectId !== "hydro-scout-staging"
) {
  throw new Error(
    "Staging Firebase isolation failed: unexpected project.",
  );
}

if (
  !isLocalDevelopment &&
  firebaseTarget === "production" &&
  app.options.projectId !== "hydro-scout"
) {
  throw new Error(
    "Production Firebase isolation failed: unexpected project.",
  );
}

export const auth = getAuth(app);

if (isLocalDevelopment) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
}

/**
 * Firestore with an IndexedDB-backed offline cache so hydrant
 * data survives a page reload without a connection.
 *
 * Browser-only: the persistent cache needs IndexedDB,
 * which doesn't exist in the Node runtime used by API routes.
 * There we fall back to the default in-memory Firestore.
 *
 * initializeFirestore also throws if called twice, such as
 * during Fast Refresh, so we fall back to the existing instance.
 */
function initDb(): Firestore {
  if (isLocalDevelopment) {
    // Never persist emulator data alongside real Firestore data.
    try {
      return initializeFirestore(app, {
        localCache: memoryLocalCache(),
      });
    } catch {
      return getFirestore(app);
    }
  }

  if (typeof window === "undefined") return getFirestore(app);

  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    return getFirestore(app);
  }
}

export const db = initDb();

if (isLocalDevelopment) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

export const storage = getStorage(app);

if (isLocalDevelopment) {
  // Storage emulator is intentionally not started.
  // Fail locally; never fall back to production Storage.
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

export default app;
