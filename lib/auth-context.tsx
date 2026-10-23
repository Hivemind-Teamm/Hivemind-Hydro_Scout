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
import { doc, getDoc, updateDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { auth, db } from "./firebase";
import { getUserProfile, watchUserProfile } from "./user-profile";
import { useLocationConsent } from './use-location-consent';
import LocationConsentNotice from '@/app/src/components/LocationConsentNotice';
import { disableDevicePush } from './browser-push';

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

export type Role = "general" | "authorized" | "head" | "admin" | null;
export type AccountType = "person" | "station" | null;

function roleForProfile(data: { role?: unknown; accountType?: unknown } | null | undefined): Role {
  // Station accounts use the app's station-operations gates, but never store or show a personal role.
  if (data?.accountType === "station") return "head";
  return typeof data?.role === "string"
    && ["general", "authorized", "head", "admin"].includes(data.role)
    ? data.role as Role
    : null;
}

interface AuthContextValue {
  canUseDeviceLocation: boolean;
  user: User | null;
  role: Role;
  accountType: AccountType;
  stationId: string | null;
  stationName: string | null;
  aorBarangays: string[];
  stationMembershipStatus: 'none' | 'pending' | 'approved' | 'rejected';
  stationAccessIds: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, displayName: string, requestedStationId?: string | null) => Promise<void>;
  openLocationConsent: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function syncSessionCookie(idToken: string | null) {
  await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [accountType, setAccountType] = useState<AccountType>(null);
  const [assignedStationId, setAssignedStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string | null>(null);
  const [stationMembershipStatus, setStationMembershipStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>('none');
  const [stationAccessIds, setStationAccessIds] = useState<string[]>([]);
  const [aorBarangays, setAorBarangays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionGeneration = useRef(0);
  const locationConsent = useLocationConsent(user?.uid);
  const { stationId, granted: locationGranted } = locationConsent;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const [profile, idToken] = await Promise.all([
            getUserProfile(firebaseUser.uid),
            firebaseUser.getIdToken(),
          ]);
          const data = profile.data ?? null;

          const profileName = data?.accountType === "station" ? data.station : data?.displayName;
          const fsName = typeof profileName === "string" ? profileName.trim() : "";
          if (fsName && firebaseUser.displayName !== fsName) {
            try { await updateProfile(firebaseUser, { displayName: fsName }); } catch { /* non-fatal */ }
          }

          setUser(firebaseUser);
          setRole(roleForProfile(data));
          setAccountType(data?.accountType === "station" || data?.accountType === "person" ? data.accountType : null);
          setAssignedStationId(typeof data?.stationId === "string" ? data.stationId : null);
          setStationName(typeof data?.station === "string" && data.station.trim() ? data.station.trim() : null);
          setStationMembershipStatus(
            data?.stationMembershipStatus === 'approved' || data?.stationMembershipStatus === 'pending'
              || data?.stationMembershipStatus === 'rejected' ? data.stationMembershipStatus : 'none',
          );
          setStationAccessIds(Array.isArray(data?.stationAccessIds)
            ? data.stationAccessIds.filter((value): value is string => typeof value === 'string') : []);
          setAorBarangays(Array.isArray(data?.aorBarangays) ? data.aorBarangays.filter((value): value is string => typeof value === "string") : []);
          // Re-issue the session cookie on every auth state change (including
          // page reload) so server routes like /api/upload can always verify the user.
          await syncSessionCookie(idToken);
        } catch (err) {
          console.error("Failed to load user role:", err);
          setUser(firebaseUser);
          setRole(null);
          setAccountType(null);
          setAssignedStationId(null);
          setStationName(null);
          setStationMembershipStatus('none');
          setStationAccessIds([]);
          setAorBarangays([]);
        }
      } else {
        setUser(null);
        setRole(null);
        setAccountType(null);
        setAssignedStationId(null);
        setStationName(null);
        setStationMembershipStatus('none');
        setStationAccessIds([]);
        setAorBarangays([]);
        await syncSessionCookie(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    return watchUserProfile(user.uid, data => {
      setRole(roleForProfile(data));
      setAccountType(data?.accountType === 'station' || data?.accountType === 'person' ? data.accountType : null);
      setAssignedStationId(typeof data?.stationId === 'string' ? data.stationId : null);
      setStationName(typeof data?.station === 'string' && data.station.trim() ? data.station.trim() : null);
      setStationMembershipStatus(
        data?.stationMembershipStatus === 'approved' || data?.stationMembershipStatus === 'pending'
          || data?.stationMembershipStatus === 'rejected' ? data.stationMembershipStatus : 'none',
      );
      setStationAccessIds(Array.isArray(data?.stationAccessIds)
        ? data.stationAccessIds.filter((value): value is string => typeof value === 'string') : []);
      setAorBarangays(Array.isArray(data?.aorBarangays)
        ? data.aorBarangays.filter((value): value is string => typeof value === 'string') : []);
    }, err => {
      console.error('Failed to watch user profile updates:', err);
      setRole(null);
      setAccountType(null);
      setAssignedStationId(null);
      setStationName(null);
      setStationMembershipStatus('none');
      setStationAccessIds([]);
      setAorBarangays([]);
    });
  }, [user]);

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
      const profile = await getUserProfile(cred.user.uid);
      await updateDoc(profile.ref, { lastLoginAt: serverTimestamp() });
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

  async function signup(email: string, password: string, displayName: string, requestedStationId: string | null = null) {
    const stationId = requestedStationId?.trim() || null;
    if (stationId) {
      const station = await getDoc(doc(db, 'stations', stationId));
      if (!station.exists() || station.data().active !== true) throw new Error('That station is not available for sign-up.');
    }
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      friendlyAuthError(err);
    }

    const batch = writeBatch(db);
    batch.set(doc(db, "users", cred.user.uid), {
      email,
      displayName,
      role: "general",
      accountType: "person",
      stationMembershipStatus: stationId ? 'pending' : 'none',
      ...(stationId ? { requestedStationId: stationId } : {}),
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
    if (stationId) {
      batch.set(doc(db, 'stationJoinRequests', cred.user.uid), {
        uid: cred.user.uid,
        displayName,
        email,
        stationId,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();

    // Also stamp the personal name onto the Firebase Auth profile so
    // `user.displayName` is populated immediately (the app reads it for the top
    // bar, account center, report attribution, etc.) rather than falling back
    // to the email prefix.
    try { await updateProfile(cred.user, { displayName }); } catch { /* non-fatal */ }

    // onAuthStateChanged fires after createUserWithEmailAndPassword and handles
    // syncSessionCookie — no need to call it again here.
  }

  async function logout() {
    if (auth.currentUser) await disableDevicePush(auth.currentUser);
    ++sessionGeneration.current;
    await firebaseSignOut(auth);
    await syncSessionCookie(null);
  }

  async function refreshSession() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const idToken = await currentUser.getIdToken(true);
    await syncSessionCookie(idToken);
  }

  return (
    <AuthContext.Provider value={{ user, role, accountType, stationId: assignedStationId, stationName, aorBarangays, stationMembershipStatus, stationAccessIds, loading, login, logout, signup, refreshSession, openLocationConsent: locationConsent.openNotice, canUseDeviceLocation: locationConsent.canUseDeviceLocation }}>
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
