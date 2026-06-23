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

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

export default app;