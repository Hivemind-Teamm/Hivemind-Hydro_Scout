// lib/firebase.ts

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

export const firebaseConfig = {
  apiKey: "AIzaSyD343gpPDZEUGzzVmIEqDCHQaxMlueWIpE",
  authDomain: "hydro-scout.firebaseapp.com",
  projectId: "hydro-scout",
  storageBucket: "hydro-scout.firebasestorage.app",
  messagingSenderId: "626033823119",
  appId: "1:626033823119:web:b0dfa6b41fadd348830ffa",
  measurementId: "G-7JQTPTSKD5",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

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
export const storage = getStorage(app);
export default app;