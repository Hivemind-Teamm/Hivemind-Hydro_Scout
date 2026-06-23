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
import { auth, db } from "./firebase";

export type Role = "general" | "authorized" | "head" | "admin" | null;

interface AuthContextValue {
  user: User | null;
  role: Role;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
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
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        setRole((snap.exists() ? snap.data().role : null) as Role);
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  async function login(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password);

    await setDoc(
      doc(db, "users", cred.user.uid),
      { lastLoginAt: serverTimestamp() },
      { merge: true }
    );

    const idToken = await cred.user.getIdToken();
    await syncSessionCookie(idToken);
  }

  async function signup(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);

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

  return (
    <AuthContext.Provider value={{ user, role, loading, login, logout, signup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}