"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, getDoc, updateDoc, serverTimestamp, writeBatch, type DocumentData } from "firebase/firestore";
import { FirebaseError } from "firebase/app";
import { auth, db } from "./firebase";
import { getUserProfile, watchUserProfile } from "./user-profile";
import { useLocationConsent } from "./use-location-consent";
import LocationConsentNotice from "@/app/src/components/LocationConsentNotice";
import { disableDevicePush } from "./browser-push";
import { getExistingIncidentDeviceId } from "./incident-device-id";
import { deleteIncidentDeviceLocation } from "./incident-device-location-cleanup";
import { incidentLocationCleanupRegistry } from "./incident-location-cleanup-registry.mjs";
import { cleanupIncidentLocationBeforeLogout } from "./incident-logout-cleanup.mjs";

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
type MembershipStatus = "none" | "pending" | "approved" | "rejected";

interface AuthContextValue {
  canUseDeviceLocation: boolean;
  user: User | null;
  role: Role;
  accountType: AccountType;
  stationId: string | null;
  stationName: string | null;
  aorBarangays: string[];
  stationMembershipStatus: MembershipStatus;
  stationAccessIds: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, displayName: string, requestedStationId?: string | null) => Promise<void>;
  openLocationConsent: () => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function roleForProfile(data: DocumentData | null | undefined): Role {
  if (data?.accountType === "station") return "head";
  return data && ["general", "authorized", "head", "admin"].includes(data.role)
    ? (data.role as Role)
    : null;
}

function accountTypeForProfile(data: DocumentData | null | undefined): AccountType {
  return data?.accountType === "station" || data?.accountType === "person" ? data.accountType : null;
}

function stationIdForProfile(data: DocumentData | null | undefined): string | null {
  return typeof data?.stationId === "string" && STATION_ID_PATTERN.test(data.stationId)
    ? data.stationId
    : null;
}

async function syncSessionCookie(idToken: string | null): Promise<void> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) throw new Error("Could not synchronize the server session.");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [accountType, setAccountType] = useState<AccountType>(null);
  const [assignedStationId, setAssignedStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState<string | null>(null);
  const [stationMembershipStatus, setStationMembershipStatus] = useState<MembershipStatus>("none");
  const [stationAccessIds, setStationAccessIds] = useState<string[]>([]);
  const [aorBarangays, setAorBarangays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionGeneration = useRef(0);
  const locationConsent = useLocationConsent(user?.uid);
  const { stationId: consentStationId, granted: locationGranted } = locationConsent;

  function clearProfile() {
    setRole(null);
    setAccountType(null);
    setAssignedStationId(null);
    setStationName(null);
    setStationMembershipStatus("none");
    setStationAccessIds([]);
    setAorBarangays([]);
  }

  function applyProfile(data: DocumentData | null | undefined) {
    setRole(roleForProfile(data));
    setAccountType(accountTypeForProfile(data));
    setAssignedStationId(stationIdForProfile(data));
    setStationName(typeof data?.station === "string" && data.station.trim() ? data.station.trim() : null);
    setStationMembershipStatus(
      data?.stationMembershipStatus === "approved" ||
      data?.stationMembershipStatus === "pending" ||
      data?.stationMembershipStatus === "rejected"
        ? data.stationMembershipStatus
        : "none",
    );
    setStationAccessIds(Array.isArray(data?.stationAccessIds)
      ? data.stationAccessIds.filter((value: unknown): value is string => typeof value === "string")
      : []);
    setAorBarangays(Array.isArray(data?.aorBarangays)
      ? data.aorBarangays.filter((value: unknown): value is string => typeof value === "string")
      : []);
  }

  useEffect(() => {
    let disposed = false;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const generation = ++sessionGeneration.current;
      setUser(null);
      clearProfile();
      setLoading(true);

      const isCurrent = () => !disposed && generation === sessionGeneration.current && auth.currentUser?.uid === firebaseUser?.uid;

      if (!firebaseUser) {
        try {
          await syncSessionCookie(null);
        } catch (error) {
          console.error("Failed to clear server session:", error);
        } finally {
          if (isCurrent()) setLoading(false);
        }
        return;
      }

      try {
        const [profile, idToken] = await Promise.all([
          getUserProfile(firebaseUser.uid),
          firebaseUser.getIdToken(),
        ]);
        if (!isCurrent()) return;

        const data = profile.data ?? null;
        const profileName = data?.accountType === "station" ? data.station : data?.displayName;
        const displayName = typeof profileName === "string" ? profileName.trim() : "";
        if (displayName && firebaseUser.displayName !== displayName) {
          try { await updateProfile(firebaseUser, { displayName }); }
          catch { /* Name backfill is non-fatal. */ }
        }
        if (!isCurrent()) return;

        // Do not expose station privileges before the server accepts the session.
        await syncSessionCookie(idToken);
        if (!isCurrent()) return;

        setUser(firebaseUser);
        applyProfile(data);
      } catch (error) {
        if (!isCurrent()) return;
        console.error("Failed to initialize authenticated profile:", error);
        setUser(firebaseUser);
        clearProfile(); // Fail closed: no station or administrative access.
      } finally {
        if (isCurrent()) setLoading(false);
      }
    });

    return () => {
      disposed = true;
      ++sessionGeneration.current;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    const generation = sessionGeneration.current;
    const isCurrent = () => sessionGeneration.current === generation && auth.currentUser?.uid === uid;

    return watchUserProfile(uid, data => {
      if (isCurrent()) applyProfile(data ?? null);
    }, error => {
      if (!isCurrent()) return;
      console.error("Failed to watch user profile updates:", error);
      clearProfile(); // Fail closed if profile authorization cannot be verified.
    });
  }, [user]);

  async function login(email: string, password: string) {
    let credential;
    try { credential = await signInWithEmailAndPassword(auth, email, password); }
    catch (error) { friendlyAuthError(error); }

    try {
      const profile = await getUserProfile(credential.user.uid);
      await updateDoc(profile.ref, { lastLoginAt: serverTimestamp() });
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== "not-found") throw error;
    }
  }

  async function signup(email: string, password: string, displayName: string, requestedStationId: string | null = null) {
    const stationId = requestedStationId?.trim() || null;
    if (stationId) {
      if (!STATION_ID_PATTERN.test(stationId)) throw new Error("Invalid station ID.");
      const station = await getDoc(doc(db, "stations", stationId));
      if (!station.exists() || station.data().active !== true) {
        throw new Error("That station is not available for sign-up.");
      }
    }

    let credential;
    try { credential = await createUserWithEmailAndPassword(auth, email, password); }
    catch (error) { friendlyAuthError(error); }

    const batch = writeBatch(db);
    batch.set(doc(db, "users", credential.user.uid), {
      email,
      displayName,
      role: "general",
      accountType: "person",
      stationMembershipStatus: stationId ? "pending" : "none",
      ...(stationId ? { requestedStationId: stationId } : {}),
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
    if (stationId) {
      batch.set(doc(db, "stationJoinRequests", credential.user.uid), {
        uid: credential.user.uid,
        displayName,
        email,
        stationId,
        status: "pending",
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
    try { await updateProfile(credential.user, { displayName }); }
    catch { /* Non-fatal. */ }
  }

  async function logout() {
    const currentUser = auth.currentUser;
    if (currentUser) {
      // Stop GPS and delete this device's incident position before sign-out.
      // A failed deletion must block sign-out rather than leave an orphaned position.
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
      await disableDevicePush(currentUser);
    }

    ++sessionGeneration.current;
    clearProfile();
    setUser(null);
    await firebaseSignOut(auth);
    await syncSessionCookie(null);
  }

  async function refreshSession() {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    await syncSessionCookie(await currentUser.getIdToken(true));
  }

  return (
    <AuthContext.Provider value={{
      user, role, accountType, stationId: assignedStationId, stationName,
      aorBarangays, stationMembershipStatus, stationAccessIds, loading,
      login, logout, signup, refreshSession,
      openLocationConsent: locationConsent.openNotice,
      canUseDeviceLocation: locationConsent.canUseDeviceLocation,
    }}>
      {children}
      {consentStationId && (
        <button
          type="button"
          onClick={locationConsent.openNotice}
          className="fixed right-3 top-20 z-[5000] rounded-lg bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow dark:bg-neutral-800 dark:text-white"
        >
          Location privacy · {locationGranted ? "On" : "Off"}
        </button>
      )}
      {locationConsent.noticeOpen && (
        <LocationConsentNotice
          granted={locationGranted}
          storageError={locationConsent.storageError}
          onAllow={() => locationConsent.decide("granted")}
          onDecline={() => locationConsent.decide("declined")}
          onClose={locationConsent.closeNotice}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
