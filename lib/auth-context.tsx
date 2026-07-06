// lib/auth-context.tsx

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
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

interface AuthContextValue {
  user: User | null;
  role: Role;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const [snap, idToken] = await Promise.all([
            getDoc(doc(db, "users", firebaseUser.uid)),
            firebaseUser.getIdToken(),
          ]);
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

          setUser(firebaseUser);
          setRole((data?.role ?? null) as Role);
          // Re-issue the session cookie on every auth state change (including
          // page reload) so server routes like /api/upload can always verify the user.
          await syncSessionCookie(idToken);
        } catch (err) {
          console.error("Failed to load user role:", err);
          setUser(firebaseUser);
          setRole(null);
        }
      } else {
        setUser(null);
        setRole(null);
        await syncSessionCookie(null);
      }
      setLoading(false);
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
    <AuthContext.Provider value={{ user, role, loading, login, logout, signup, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}