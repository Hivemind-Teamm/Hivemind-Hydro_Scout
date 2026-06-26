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
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
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
      setUser(firebaseUser);

      if (firebaseUser) {
        const [snap, idToken] = await Promise.all([
          getDoc(doc(db, "users", firebaseUser.uid)),
          firebaseUser.getIdToken(),
        ]);
        setRole((snap.exists() ? snap.data().role : null) as Role);
        // Re-issue the session cookie on every auth state change (including
        // page reload) so server routes like /api/upload can always verify the user.
        await syncSessionCookie(idToken);
      } else {
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

    await setDoc(
      doc(db, "users", cred.user.uid),
      { lastLoginAt: serverTimestamp() },
      { merge: true }
    );

    const idToken = await cred.user.getIdToken();
    await syncSessionCookie(idToken);
  }

  async function signup(email: string, password: string, displayName: string) {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      friendlyAuthError(err);
    }

    // Create the user document — new accounts always start as 'general'.
    // merge:true is defensive: if a document somehow already exists for this
    // uid, we never clobber an existing role (e.g. an admin) back to 'general'.
    await setDoc(
      doc(db, "users", cred.user.uid),
      {
        email,
        displayName,
        role: "general",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      },
      { merge: true },
    );

    const idToken = await cred.user.getIdToken();
    await syncSessionCookie(idToken);
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