// lib/firebase.ts

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
 * Development is emulator-only. Never use the production Firebase project
 * while running Next.js in development mode.
 */
const isLocalDevelopment = process.env.NODE_ENV === "development";

export const firebaseConfig = isLocalDevelopment
  ? {
      apiKey: "demo-emulator-only-key",
      authDomain: "localhost",
      projectId: "demo-hydro-scout-api",
      storageBucket: "demo-hydro-scout-api.appspot.com",
      messagingSenderId: "000000000000",
      appId: "1:000000000000:web:demo-hydro-scout-api",
    }
  : productionFirebaseConfig;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

if (
  isLocalDevelopment &&
  app.options.projectId !== "demo-hydro-scout-api"
) {
  throw new Error(
    "Development Firebase isolation failed: unexpected project.",
  );
}

export const auth = getAuth(app);

if (isLocalDevelopment) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
}

/**
 * Firestore with an IndexedDB-backed offline cache so hydrant data survives a
 * page reload with no connection (in-memory state alone is lost on refresh).
 *
 * Browser-only: the persistent cache needs IndexedDB, which doesn't exist in
 * the Node runtime used by the API routes that also import this module — there
 * we fall back to the default in-memory Firestore. `initializeFirestore` also
 * throws if called twice (e.g. Fast Refresh re-evaluating this module), so we
 * fall back to the already-initialised instance on any failure.
 */
function initDb(): Firestore {
  if (isLocalDevelopment) {
    // Never persist emulator data alongside real offline Firestore data.
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
  // Storage emulator is intentionally not started. Fail locally,
  // never fall back to production Storage.
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

export default app;