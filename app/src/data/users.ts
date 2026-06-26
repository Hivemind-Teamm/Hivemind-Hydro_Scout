'use client';

// Admin user-directory data layer for Hydro-Scout.
//
// Reads the `users` collection live (admin-only — enforced by firestore.rules:
// `allow read: if isSignedIn() && (request.auth.uid == uid || isAdmin())`),
// and exposes the mutations the System Administration panel needs:
//   • change a user's role        (updateDoc — admin path in rules)
//   • create a brand-new account  (real Auth account via a SECONDARY Firebase
//                                  app so the signed-in admin is NOT logged out)
//   • remove an account           (deletes the user document)
//
// Removing only deletes the Firestore document, not the underlying Firebase
// Auth record — fully revoking the login requires the Admin SDK on a server.

import { useEffect, useState } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as secondarySignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { db, firebaseConfig } from '@/lib/firebase';

export type UserRole = 'general' | 'authorized' | 'head' | 'admin';

export const ROLE_ORDER: UserRole[] = ['general', 'authorized', 'head', 'admin'];

export interface RoleMeta {
  label: string;
  badgeBg: string;
  badgeText: string;
  dot: string;
}

export const ROLE_META: Record<UserRole, RoleMeta> = {
  general:    { label: 'General',    badgeBg: '#f1f5f9', badgeText: '#475569', dot: '#94a3b8' },
  authorized: { label: 'Authorized', badgeBg: '#fff4e0', badgeText: '#b45309', dot: '#f59e0b' },
  head:       { label: 'Head',       badgeBg: '#ede9fe', badgeText: '#6d28d9', dot: '#7c3aed' },
  admin:      { label: 'Admin',      badgeBg: '#fce8e9', badgeText: '#e0353b', dot: '#e0353b' },
};

export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  station: string;
  initials: string;
  /** false until the account has logged in at least once */
  active: boolean;
  lastLoginLabel: string;
}

function toRole(value: unknown): UserRole {
  const v = String(value ?? '').toLowerCase();
  return (ROLE_ORDER as string[]).includes(v) ? (v as UserRole) : 'general';
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try { return (value as { toDate: () => Date }).toDate(); } catch { return null; }
  }
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeLabel(d: Date | null): string {
  if (!d) return 'Never signed in';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Active now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function userFromDoc(id: string, d: DocumentData): AppUser {
  const displayName: string =
    (typeof d.displayName === 'string' && d.displayName.trim()) ||
    (typeof d.email === 'string' ? d.email.split('@')[0] : 'Unknown User');
  const lastLogin = toDate(d.lastLoginAt);
  return {
    uid: id,
    displayName,
    email: typeof d.email === 'string' ? d.email : '—',
    role: toRole(d.role),
    station: (typeof d.station === 'string' && d.station.trim()) || 'Unassigned',
    initials: initialsOf(displayName),
    active: !!lastLogin,
    lastLoginLabel: relativeLabel(lastLogin),
  };
}

export interface UsersState {
  users: AppUser[];
  loading: boolean;
  error: string | null;
}

/** Live subscription to the user directory. Only resolves for admins. */
export function useUsers(): UsersState {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list = snap.docs.map((d) => userFromDoc(d.id, d.data()));
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load users:', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { users, loading, error };
}

/** Promote / demote a user. Admin-only (firestore.rules). */
export async function updateUserRole(uid: string, role: UserRole): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { role });
}

/** Remove a user from the directory (deletes their Firestore document). */
export async function deleteUserAccount(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid));
}

export interface CreateAccountInput {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;
  station: string;
}

// Creates a real Firebase Auth account WITHOUT disturbing the signed-in admin.
//
// A second, throwaway Firebase app instance owns the new sign-in, so the
// primary `auth` (the admin's session) is untouched. The Firestore user
// document is written through the PRIMARY `db`, where the admin is still
// authenticated, so the admin-create path in firestore.rules applies.
export async function createUserAccount(input: CreateAccountInput): Promise<void> {
  const secondary = initializeApp(firebaseConfig, `admin-create-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(
      secondaryAuth,
      input.email.trim(),
      input.password,
    );

    if (input.displayName.trim()) {
      await updateProfile(cred.user, { displayName: input.displayName.trim() });
    }

    await setDoc(doc(db, 'users', cred.user.uid), {
      uid: cred.user.uid,
      email: input.email.trim(),
      displayName: input.displayName.trim(),
      role: input.role,
      station: input.station.trim() || 'Unassigned',
      createdAt: serverTimestamp(),
      lastLoginAt: null,
    });

    await secondarySignOut(secondaryAuth).catch(() => {});
  } finally {
    await deleteApp(secondary).catch(() => {});
  }
}
