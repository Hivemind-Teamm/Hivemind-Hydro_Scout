// lib/firebase.ts

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);
export default app;