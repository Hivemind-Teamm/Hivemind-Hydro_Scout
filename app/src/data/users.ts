'use client';

// Admin user-directory data layer for Hydro-Scout.
//
// Reads the `users` collection live and exposes the mutations the
// System Administration panel needs.
//
// F1 Station Accounts + AOR:
//   • stationId identifies the fire station an account belongs to.
//   • aorBarangays contains the barangays inside that station's
//     Area of Responsibility.
//   • station is retained as the human-readable station name for
//     backward compatibility with the existing UI.

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

export const ROLE_ORDER: UserRole[] = [
  'general',
  'authorized',
  'head',
  'admin',
];

export interface RoleMeta {
  label: string;
  badgeBg: string;
  badgeText: string;
  dot: string;
}

export const ROLE_META: Record<UserRole, RoleMeta> = {
  general: {
    label: 'General',
    badgeBg: '#f1f5f9',
    badgeText: '#475569',
    dot: '#94a3b8',
  },
  authorized: {
    label: 'Authorized',
    badgeBg: '#fff4e0',
    badgeText: '#b45309',
    dot: '#f59e0b',
  },
  head: {
    label: 'Head',
    badgeBg: '#ede9fe',
    badgeText: '#6d28d9',
    dot: '#7c3aed',
  },
  admin: {
    label: 'Admin',
    badgeBg: '#fce8e9',
    badgeText: '#e0353b',
    dot: '#e0353b',
  },
};

export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;

  // Existing human-readable station name.
  station: string;

  // F1: stable station identifier used across features.
  stationId: string | null;

  // F1: barangays inside this station/account's Area of Responsibility.
  aorBarangays: string[];

  initials: string;

  /** false until the account has logged in at least once */
  active: boolean;

  lastLoginLabel: string;
}

function toRole(value: unknown): UserRole {
  const v = String(value ?? '').toLowerCase();

  return (ROLE_ORDER as string[]).includes(v)
    ? (v as UserRole)
    : 'general';
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

function toDate(value: unknown): Date | null {
  if (!value) return null;

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value
  ) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }

  const d = new Date(value as string);

  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeLabel(d: Date | null): string {
  if (!d) return 'Never signed in';

  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);

  if (mins < 1) return 'Active now';

  if (mins < 60) {
    return `${mins} min ago`;
  }

  const hrs = Math.floor(mins / 60);

  if (hrs < 24) {
    return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hrs / 24);

  if (days < 30) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function readAorBarangays(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (barangay): barangay is string =>
        typeof barangay === 'string',
    )
    .map((barangay) => barangay.trim())
    .filter(Boolean);
}

export function userFromDoc(
  id: string,
  d: DocumentData,
): AppUser {
  const displayName: string =
    (typeof d.displayName === 'string' &&
      d.displayName.trim()) ||
    (typeof d.email === 'string'
      ? d.email.split('@')[0]
      : 'Unknown User');

  const lastLogin = toDate(d.lastLoginAt);

  const stationId =
    typeof d.stationId === 'string' &&
    d.stationId.trim()
      ? d.stationId.trim()
      : null;

  return {
    uid: id,
    displayName,

    email:
      typeof d.email === 'string'
        ? d.email
        : '—',

    role: toRole(d.role),

    station:
      (typeof d.station === 'string' &&
        d.station.trim()) ||
      'Unassigned',

    stationId,

    aorBarangays: readAorBarangays(
      d.aorBarangays,
    ),

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

/**
 * Live subscription to the user directory.
 * Only resolves for admins according to Firestore rules.
 */
export function useUsers(): UsersState {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'users'),

      (snap) => {
        const list = snap.docs.map((d) =>
          userFromDoc(d.id, d.data()),
        );

        list.sort((a, b) =>
          a.displayName.localeCompare(
            b.displayName,
          ),
        );

        setUsers(list);
        setLoading(false);
      },

      (err) => {
        console.error(
          'Failed to load users:',
          err,
        );

        setError(err.message);
        setLoading(false);
      },
    );

    return unsub;
  }, []);

  return {
    users,
    loading,
    error,
  };
}

/**
 * Promote / demote a user.
 * Admin-only according to Firestore rules.
 */
export async function updateUserRole(
  uid: string,
  role: UserRole,
): Promise<void> {
  await updateDoc(
    doc(db, 'users', uid),
    { role },
  );
}

/**
 * Remove a user from the directory.
 *
 * This deletes the Firestore user document only.
 * It does not delete the Firebase Auth account.
 */
export async function deleteUserAccount(
  uid: string,
): Promise<void> {
  await deleteDoc(
    doc(db, 'users', uid),
  );
}

export interface CreateAccountInput {
  displayName: string;
  email: string;
  password: string;
  role: UserRole;

  // Existing display name.
  station: string;

  // F1 Station Accounts + AOR.
  stationId: string | null;
  aorBarangays: string[];
}

/**
 * Creates a real Firebase Auth account without disturbing
 * the signed-in administrator.
 *
 * A secondary Firebase app owns the temporary authentication
 * session for the newly-created user.
 */
export async function createUserAccount(
  input: CreateAccountInput,
): Promise<void> {
  const secondary = initializeApp(
    firebaseConfig,
    `admin-create-${Date.now()}`,
  );

  try {
    const secondaryAuth =
      getAuth(secondary);

    const cred =
      await createUserWithEmailAndPassword(
        secondaryAuth,
        input.email.trim(),
        input.password,
      );

    if (input.displayName.trim()) {
      await updateProfile(
        cred.user,
        {
          displayName:
            input.displayName.trim(),
        },
      );
    }

    const stationId =
      typeof input.stationId === 'string' &&
      input.stationId.trim()
        ? input.stationId.trim()
        : null;

    const aorBarangays =
      readAorBarangays(
        input.aorBarangays,
      );

    await setDoc(
      doc(db, 'users', cred.user.uid),
      {
        uid: cred.user.uid,

        email:
          input.email.trim(),

        displayName:
          input.displayName.trim(),

        role:
          input.role,

        station:
          input.station.trim() ||
          'Unassigned',

        // F1 Station Accounts + AOR.
        stationId,
        aorBarangays,

        createdAt:
          serverTimestamp(),

        lastLoginAt:
          null,
      },
    );

    await secondarySignOut(
      secondaryAuth,
    ).catch(() => {});
  } finally {
    await deleteApp(
      secondary,
    ).catch(() => {});
  }
}