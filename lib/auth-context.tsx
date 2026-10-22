// lib/auth-context.tsx

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { auth, db } from "./firebase";
import { getExistingIncidentDeviceId } from "./incident-device-id";
import { deleteIncidentDeviceLocation } from "./incident-device-location-cleanup";
import { incidentLocationCleanupRegistry } from "./incident-location-cleanup-registry.mjs";
import { cleanupIncidentLocationBeforeLogout } from "./incident-logout-cleanup.mjs";
import { useLocationConsent } from './use-location-consent';
import LocationConsentNotice from '@/app/src/components/LocationConsentNotice';

function friendlyAuthError(err: unknown): never {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        throw new Error("Incorrect email or password.");
      case "auth/invalid-email":
        throw new Error("That email address is not valid.");
      case "auth/user-disabled":
        throw new Error("This account has been disabled.");
      case "auth/too-many-requests":
        throw new Error("Too many attempts. Please try again later.");
      case "auth/email-already-in-use":
        throw new Error("An account with this email already exists.");
      case "auth/weak-password":
        throw new Error("Password should be at least 6 characters.");
    }
  }
  throw err;
}

export type Role = "general" | "authorized" | "head" | "admin" | "sub_admin" | null;

interface AuthContextValue {
  canUseDeviceLocation: boolean;
  user: User | null;
  role: Role;
  stationId: string | null;
  trustedStationId: string | null;
  aorBarangays: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

let sessionCookieSyncQueue: Promise<void> = Promise.resolve();

function syncSessionCookie(idToken: string | null): Promise<void> {
  // Serialize cookie-changing requests from this browser page.
  // An older response must not finish after a newer request.
  const operation = sessionCookieSyncQueue.then(async () => {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!response.ok) {
      throw new Error('session-verification-failed');
    }

    const result: unknown = await response.json();

    if (
      !result ||
      typeof result !== 'object' ||
      !('ok' in result) ||
      result.ok !== true
    ) {
      throw new Error('session-verification-failed');
    }
  });

  // A failed request must not permanently block later logout/login.
  sessionCookieSyncQueue = operation.catch(() => {});

  // The caller still receives the original failure.
  return operation;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [trustedStationId, setTrustedStationId] = useState<string | null>(null);
  const [aorBarangays, setAorBarangays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionGeneration = useRef(0);
  const locationConsent = useLocationConsent(user?.uid);
  const { stationId, granted: locationGranted } = locationConsent;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const authGeneration = ++sessionGeneration.current;

      // Revoke trusted location eligibility during every auth transition.
      setRole(null);
      setTrustedStationId(null);

      if (firebaseUser) {
        try {
          const [snap, idToken] = await Promise.all([
            getDoc(doc(db, "users", firebaseUser.uid)),
            firebaseUser.getIdToken(),
          ]);
          // Ignore results from an older authentication event.
          if (
            authGeneration !== sessionGeneration.current ||
            auth.currentUser?.uid !== firebaseUser.uid
          ) return;

          const data = snap.exists() ? snap.data() : null;

          // The person's real name is stored on the Firestore user doc at signup;
          // the Firebase Auth profile starts blank. Backfill it here so
          // `user.displayName` carries the personal name everywhere (top bar,
          // account center) instead of an email-prefix guess. Runs at most once
          // per account — skipped as soon as the Auth profile has a name — and
          // fixes accounts created before this backfill existed, on next load.
          const fsName = typeof data?.displayName === "string" ? data.displayName.trim() : "";
          if (fsName && firebaseUser.displayName !== fsName) {
            try { await updateProfile(firebaseUser, { displayName: fsName }); } catch { /* non-fatal */ }
          }

          // Do not authorize a station before the server verifies the session.
          await syncSessionCookie(idToken);

          // A completed session request must still belong to this event.
          if (
            authGeneration !== sessionGeneration.current ||
            auth.currentUser?.uid !== firebaseUser.uid
          ) return;

          setUser(firebaseUser);
          setRole((data?.role ?? null) as Role);

          // Independent of legacy location consent. This identity comes
          // only from the authenticated user's Firestore profile.
          const trustedStation =
            data?.role === "sub_admin" &&
            data?.accountType === "station" &&
            typeof data?.stationId === "string" &&
            /^[A-Za-z0-9_-]{1,128}$/.test(data.stationId)
              ? data.stationId
              : null;

          setTrustedStationId(trustedStation);
          setAorBarangays(Array.isArray(data?.aorBarangays) ? data.aorBarangays.filter((value): value is string => typeof value === "string") : []);
          // The server session was verified before role/station state was set.
        } catch (err) {
          // A stale failure must not clear a newer user's permissions.
          if (authGeneration !== sessionGeneration.current) return;

          console.error("Failed to load user role:", err);
          setUser(firebaseUser);
          setRole(null);
          setTrustedStationId(null);
          setAorBarangays([]);
        }
      } else {
        setUser(null);
        setRole(null);
        setTrustedStationId(null);
        setAorBarangays([]);
        try {
          await syncSessionCookie(null);
        } catch (err) {
          // Auth and trusted station state have already been revoked.
          console.error('Failed to clear server session:', err);
        }
      }
      if (authGeneration === sessionGeneration.current) {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);


  async function login(email: string, password: string) {
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      friendlyAuthError(err);
    }

    // Only update lastLoginAt on an EXISTING document — never create one here,
    // since a document created without a role field causes the user to appear
    // as "general" even if an admin later assigns a higher role in Firestore.
    try {
      await updateDoc(doc(db, "users", cred.user.uid), { lastLoginAt: serverTimestamp() });
    } catch (err: unknown) {
      // Document doesn't exist yet (admin-created account whose Firestore write
      // failed, or a manually imported Auth account).  Silently skip — the role
      // will be read as null by onAuthStateChanged and the admin can assign one
      // via the admin panel once the document is created.
      if ((err as { code?: string }).code !== "not-found") throw err;
    }

    // onAuthStateChanged fires after signInWithEmailAndPassword and handles
    // syncSessionCookie — no need to call it again here.
  }

  async function signup(email: string, password: string, displayName: string) {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      friendlyAuthError(err);
    }

    // createUserWithEmailAndPassword always produces a brand-new UID, so no
    // Firestore document for this UID can exist yet — write without merge so
    // the document is created cleanly with role: "general".
    await setDoc(doc(db, "users", cred.user.uid), {
      email,
      displayName,
      role: "general",
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });

    // Also stamp the personal name onto the Firebase Auth profile so
    // `user.displayName` is populated immediately (the app reads it for the top
    // bar, account center, report attribution, etc.) rather than falling back
    // to the email prefix.
    try { await updateProfile(cred.user, { displayName }); } catch { /* non-fatal */ }

    // onAuthStateChanged fires after createUserWithEmailAndPassword and handles
    // syncSessionCookie — no need to call it again here.
  }

  async function logout() {
    const currentUser = auth.currentUser;

    // Always check for an existing incident location before sign-out.
    // Do not rely on React role state, which may still be loading.
    // Users without an existing device ID or active tracking session
    // require no location deletion.
    if (currentUser) {
      await cleanupIncidentLocationBeforeLogout({
        uid: currentUser.uid,
        registry: incidentLocationCleanupRegistry,
        getExistingDeviceId: getExistingIncidentDeviceId,
        deleteDeviceLocation: async (uid: string) => {
          await deleteIncidentDeviceLocation({
            db,
            uid,
            getCurrentUid: () => auth.currentUser?.uid ?? null,
          });
        },
      });
    }

    // Do not sign out if incident cleanup failed.
    ++sessionGeneration.current;
    await firebaseSignOut(auth);
    await syncSessionCookie(null);
  }

  async function refreshSession() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    try {
      const idToken = await currentUser.getIdToken(true);
      await syncSessionCookie(idToken);
    } catch (err) {
      // A failed refresh must not leave incident GPS eligibility active.
      setRole(null);
      setTrustedStationId(null);
      throw err;
    }
  }

  return (
    <AuthContext.Provider value={{ user, role, stationId, trustedStationId, aorBarangays, loading, login, logout, signup, refreshSession, canUseDeviceLocation: locationConsent.canUseDeviceLocation }}>
      {children}
      {stationId && (
        <button type="button" onClick={locationConsent.openNotice} className="fixed right-3 top-20 z-[5000] rounded-lg bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow dark:bg-neutral-800 dark:text-white">
          Location privacy · {locationGranted ? 'On' : 'Off'}
        </button>
      )}
      {locationConsent.noticeOpen && <LocationConsentNotice granted={locationGranted} storageError={locationConsent.storageError}
        onAllow={() => locationConsent.decide('granted')} onDecline={() => { ++sessionGeneration.current; locationConsent.decide('declined'); }} onClose={locationConsent.closeNotice} />}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
