// lib/firebase.ts
//
// Client-side Firebase initialization. Safe to import in any 'use client'
// component. These values are public client identifiers, not secrets.

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD343gpPDZEUGzzVmIEqDCHQaxMlueWIpE",
  authDomain: "hydro-scout.firebaseapp.com",
  projectId: "hydro-scout",
  storageBucket: "hydro-scout.firebasestorage.app",
  messagingSenderId: "626033823119",
  appId: "1:626033823119:web:b0dfa6b41fadd348830ffa",
  measurementId: "G-7JQTPTSKD5",
};

// Avoid re-initializing on hot reload / multiple imports.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Offline persistence (IndexedDB): caches reads locally and queues writes
// made while offline, auto-syncing once connectivity returns.
// persistentMultipleTabManager allows multiple open tabs to share the same
// cache; without it, only one tab at a time gets persistence and others
// silently fall back to memory-only cache.
//
// initializeFirestore must be called exactly once, before any other
// Firestore call in the app — this module is that one place.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export default app;