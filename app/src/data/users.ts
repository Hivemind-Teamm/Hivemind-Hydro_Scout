'use client';

// Admin user-directory data layer for Hydro-Scout.
//
// Reads personal and station-scoped profiles live and exposes the
// mutations the System Administration panel needs.
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
  deleteUser,
  updateProfile,
  signOut as secondarySignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  writeBatch,
  where,
  serverTimestamp,
  type DocumentData,
  type Unsubscribe,
  Timestamp,
} from 'firebase/firestore';
import { db, firebaseConfig } from '@/lib/firebase';
import { accountLoginStatus } from '@/lib/account-login-status';
import { useLoginClock } from '@/lib/use-login-clock';
import { useAuth } from '@/lib/auth-context';
import { accountIsPresent, PRESENCE_EXPIRY_MS, type PresenceRecord } from '@/lib/account-presence-state';
import {
  getUserProfile,
  stationAccountIndexRef,
  stationAccountRef,
  userProfileRef,
} from '@/lib/user-profile';

export type UserRole = 'general' | 'authorized' | 'head' | 'admin';
export type AccountType = 'person' | 'station';

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
  role: UserRole | null;
  accountType: AccountType | null;
  createdAt: Date | null;

  // Existing human-readable station name.
  station: string;

  // F1: stable station identifier used across features.
  stationId: string | null;

  // F1: barangays inside this station/account's Area of Responsibility.
  aorBarangays: string[];

  initials: string;

  /** True while at least one signed-in session has fresh presence. */
  active: boolean;
  lastLoginAt: Date | null;
  activityLabel: string;
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
  const accountType = d.accountType === 'station' || d.accountType === 'person'
    ? d.accountType
    : null;
  const displayName: string =
    (accountType === 'station' && typeof d.station === 'string' && d.station.trim()) ||
    (typeof d.displayName === 'string' && d.displayName.trim()) ||
    (typeof d.email === 'string'
      ? d.email.split('@')[0]
      : 'Unknown User');

  const login = accountLoginStatus(d.lastLoginAt);

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

    role: accountType === 'station' ? null : toRole(d.role),
    accountType,
    createdAt: toDate(d.createdAt),

    station:
      (typeof d.station === 'string' &&
        d.station.trim()) ||
      'Unassigned',

    stationId,

    aorBarangays: readAorBarangays(
      d.aorBarangays,
    ),

    initials: initialsOf(displayName),

    active: false,
    lastLoginAt: login.lastLoginAt,
    activityLabel: login.label,
    lastLoginLabel: login.lastLoginLabel,
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
  const now = useLoginClock();
  const { user: viewer, role } = useAuth();
  const presenceScope = role === 'admin' ? viewer?.uid : undefined;
  const [presence, setPresence] = useState<{ scope?: string; records: PresenceRecord[]; checkedAt?: number }>({ records: [] });
  useEffect(() => {
    if (!presenceScope) return;
    // Keep one listener for the page lifetime. A cutoff derived from the ticking
    // clock re-created the query every minute and re-read every live session;
    // accountIsPresent applies expiry against `now` on the client instead.
    const cutoff = Timestamp.fromMillis(Date.now() - PRESENCE_EXPIRY_MS);
    return onSnapshot(query(collection(db, 'accountPresenceSessions'), where('lastSeenAt', '>', cutoff)), snapshot => {
      setPresence({ scope: presenceScope, records: snapshot.docs.map(record => record.data() as PresenceRecord), checkedAt: Date.now() });
    }, () => setPresence({ scope: presenceScope, records: [] }));
  }, [presenceScope]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let userDocs: AppUser[] = [];
    let stationDocs: AppUser[] = [];
    let usersLoaded = false;
    let stationDirectoryLoaded = false;
    let stationAccountLoads = new Set<string>();
    let stationProfilesByStation = new Map<string, AppUser[]>();
    let stationAccountStops: Unsubscribe[] = [];
    let stationAccountGeneration = 0;
    const publish = () => {
      const profilesByUid = new Map(userDocs.map(user => [user.uid, user]));
      for (const user of stationDocs) profilesByUid.set(user.uid, user);
      const list = [...profilesByUid.values()];
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));

      setUsers(list);
      if (usersLoaded && stationDirectoryLoaded
        && stationAccountLoads.size === stationAccountStops.length) {
        setLoading(false);
      }
    };

    const handleError = (err: Error) => {
        console.error(
          'Failed to load account profiles:',
          err,
        );

        setError(err.message);
        setLoading(false);
    };
    const stopUsers = onSnapshot(
      collection(db, 'users'),
      snap => {
        usersLoaded = true;
        userDocs = snap.docs.map(d => userFromDoc(d.id, d.data()));
        publish();
      },
      handleError,
    );
    const stopStations = onSnapshot(
      collection(db, 'stations'),
      stationsSnapshot => {
        const generation = ++stationAccountGeneration;
        stationAccountStops.forEach(stop => stop());
        stationAccountStops = [];
        stationAccountLoads = new Set();
        stationProfilesByStation = new Map();
        stationDirectoryLoaded = true;
        stationDocs = [];
        setError(null);

        const stationIds = stationsSnapshot.docs.map(station => station.id);
        if (stationIds.length === 0) {
          publish();
          return;
        }

        stationAccountStops = stationIds.map(stationId => onSnapshot(
          query(collection(db, 'stations', stationId, 'accounts'), where('accountType', '==', 'station')),
          accountSnapshot => {
            if (generation !== stationAccountGeneration) return;
            stationAccountLoads.add(stationId);
            stationProfilesByStation.set(
              stationId,
              accountSnapshot.docs.map(account => userFromDoc(account.id, account.data())),
            );
            stationDocs = [...stationProfilesByStation.values()].flat();
            publish();
          },
          handleError,
        ));
      },
      handleError,
    );

    return () => {
      stationAccountGeneration++;
      stationAccountStops.forEach(stop => stop());
      stopStations();
      stopUsers();
    };
  }, []);

  return {
    users: users.map(user => {
      const login = accountLoginStatus(user.lastLoginAt, now);
      const active = !!presenceScope && (user.uid === presenceScope
        || (presence.scope === presenceScope && accountIsPresent(presence.records, user.uid, Math.max(now, presence.checkedAt ?? now))));
      return { ...user, active, activityLabel: active ? 'Active now' : login.label, lastLoginLabel: login.lastLoginLabel };
    }),
    loading,
    error,
  };
}

/**
 * Promote / demote a user.
 * Admin-only according to Firestore rules.
 */
export async function updateUserAccount(
  uid: string,
  role: UserRole | null,
  accountType: AccountType,
  stationId: string,
  admin: { uid: string; email: string; displayName: string },
): Promise<void> {
  const assignedStationId = stationId.trim() || null;
  if (assignedStationId && !/^[A-Za-z0-9_-]{1,128}$/.test(assignedStationId)) {
    throw new Error('Choose a valid Station ID from the station directory.');
  }
  if (accountType === 'station' && !assignedStationId) {
    throw new Error('Station accounts need a valid Station ID.');
  }
  if (accountType === 'person' && !role) {
    throw new Error('Choose a role for the personal account.');
  }
  const stationSnapshot = assignedStationId ? await getDoc(doc(db, 'stations', assignedStationId)) : null;
  if (assignedStationId && (!stationSnapshot?.exists() || stationSnapshot.data().active !== true)) {
    throw new Error('Choose an active station from the station directory.');
  }
  const personalRef = userProfileRef(uid);
  const indexRef = stationAccountIndexRef(uid);

  await runTransaction(db, async transaction => {
    const [indexSnapshot, personalSnapshot] = await Promise.all([
      transaction.get(indexRef),
      transaction.get(personalRef),
    ]);
    const previousStationId = indexSnapshot.exists()
      ? indexSnapshot.data().stationId
      : null;
    if (previousStationId !== null
      && (typeof previousStationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(previousStationId))) {
      throw new Error('The station account index contains an invalid station ID.');
    }
    const sourceRef = previousStationId
      ? stationAccountRef(previousStationId, uid)
      : personalRef;
    const sourceSnapshot = sourceRef.path === personalRef.path
      ? personalSnapshot
      : await transaction.get(sourceRef);
    if (!sourceSnapshot.exists()) {
      throw new Error('The account profile could not be found.');
    }

    const targetRef = accountType === 'station' && assignedStationId
      ? stationAccountRef(assignedStationId, uid)
      : personalRef;
    const targetSnapshot = targetRef.path === sourceRef.path
      ? sourceSnapshot
      : await transaction.get(targetRef);
    const legacyStationProfile = accountType === 'person'
      && targetRef.path === personalRef.path
      && targetSnapshot.exists()
      && targetSnapshot.data().accountType === 'station';
    if (targetSnapshot.exists() && targetRef.path !== sourceRef.path && !legacyStationProfile) {
      throw new Error('A profile already exists at the selected account location.');
    }

    const profile = { ...sourceSnapshot.data() };
    const previousAccountType = profile.accountType;
    const previousAssignedStationId = profile.stationId;
    if (accountType === 'station' && typeof profile.activeResponseId === 'string') {
      throw new Error('End the active response before changing this account to a station account.');
    }

    profile.uid = uid;
    profile.accountType = accountType;
    profile.stationId = assignedStationId;
    profile.station = stationSnapshot?.exists()
      ? String(stationSnapshot.data().name ?? 'Unassigned')
      : 'Unassigned';

    if (accountType === 'station') {
      profile.displayName = profile.station;
      profile.aorBarangays = [];
      delete profile.role;
      delete profile.stationMembershipStatus;
      delete profile.requestedStationId;
      delete profile.activeResponseId;
    } else {
      if (typeof profile.displayName !== 'string' || !profile.displayName.trim()) {
        profile.displayName = typeof profile.email === 'string' ? profile.email : '';
      }
      profile.role = role;
      profile.stationMembershipStatus = assignedStationId ? 'approved' : 'none';
      delete profile.requestedStationId;
    }

    transaction.set(targetRef, profile);
    if (targetRef.path !== sourceRef.path) {
      transaction.delete(sourceRef);
    }

    if (accountType === 'station' && assignedStationId) {
      transaction.set(indexRef, { stationId: assignedStationId });
    } else if (indexSnapshot.exists()) {
      transaction.delete(indexRef);
    }

    if (accountType === 'person'
      && (previousAccountType === 'person' || (previousAccountType == null && !indexSnapshot.exists()))
      && assignedStationId
      && previousAssignedStationId !== assignedStationId) {
      if (!admin.email.trim()) {
        throw new Error('Your admin account needs an email address to notify the station head.');
      }
      const notificationRef = doc(collection(db, 'stations', assignedStationId, 'notifications'), `account-assignment-${crypto.randomUUID()}`);
      const targetName = typeof profile.displayName === 'string' && profile.displayName.trim()
        ? profile.displayName.trim()
        : profile.email;
      transaction.set(notificationRef, {
        type: 'personal-station-assigned',
        uid: admin.uid,
        displayName: admin.displayName.trim() || admin.email,
        adminEmail: admin.email,
        targetUid: uid,
        targetName,
        message: `Admin account: ${admin.email} changed "${targetName}" station to ${assignedStationId}.`,
        createdAt: serverTimestamp(),
      });
    }
  });
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
  const profile = await getUserProfile(uid);
  const batch = writeBatch(db);
  batch.delete(profile.ref);
  if (profile.ref.path !== userProfileRef(uid).path) {
    batch.delete(userProfileRef(uid));
    batch.delete(stationAccountIndexRef(uid));
  }
  await batch.commit();
}

export interface CreateAccountInput {
  displayName: string;
  email: string;
  password: string;
  role: UserRole | null;
  accountType: AccountType;

  // Existing display name.
  station: string;

  // F1 Station Accounts + AOR.
  stationId: string | null;
  aorBarangays: string[];
  newStation?: { id: string; name: string };
}

/**
 * Creates a real Firebase Auth account without disturbing
 * the signed-in administrator.
 *
 * A secondary Firebase app owns the authentication session
 * for the newly-created user.
 */
export async function createUserAccount(
  input: CreateAccountInput,
): Promise<void> {
  const newStation = input.newStation
    ? {
        id: input.newStation.id.trim(),
        name: input.newStation.name.trim(),
      }
    : null;
  if (newStation && input.accountType !== 'station') {
    throw new Error('A new station must be created with a station account.');
  }
  if (newStation && (!/^[A-Za-z0-9_-]{1,128}$/.test(newStation.id)
    || !newStation.name || newStation.name.length > 120)) {
    throw new Error('Enter a valid station name and Station ID.');
  }
  const stationId =
    newStation?.id ?? (typeof input.stationId === 'string' && input.stationId.trim()
      ? input.stationId.trim()
      : null);
  if (stationId && !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) {
    throw new Error('Choose a valid Station ID from the station directory.');
  }
  if (input.accountType === 'station' && !stationId) {
    throw new Error('Station accounts need a valid Station ID.');
  }
  if (input.accountType === 'person' && !input.role) {
    throw new Error('Choose a role for the personal account.');
  }
  const stationSnapshot = stationId ? await getDoc(doc(db, 'stations', stationId)) : null;
  if (newStation && stationSnapshot?.exists()) {
    throw new Error('That Station ID already exists.');
  }
  if (stationId && !newStation && (!stationSnapshot?.exists() || stationSnapshot.data().active !== true)) {
    throw new Error('Choose an active station from the station directory.');
  }

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

    const stationName = newStation?.name
      ?? (stationSnapshot?.exists() ? String(stationSnapshot.data().name ?? '') : '');
    const displayName = input.accountType === 'station'
      ? stationName.trim()
      : input.displayName.trim();

    if (displayName) {
      await updateProfile(
        cred.user,
        {
          displayName,
        },
      );
    }

    const aorBarangays =
      readAorBarangays(
        input.aorBarangays,
      );

    const profileData = {
      uid: cred.user.uid,

      email:
        input.email.trim(),

      displayName,

      accountType: input.accountType,
      ...(input.accountType === 'person' ? { role: input.role } : {}),

      station: stationName
        || input.station.trim()
        || 'Unassigned',

      // F1 Station Accounts + AOR.
      stationId,
      ...(input.accountType === 'person'
        ? { stationMembershipStatus: stationId ? 'approved' : 'none' }
        : {}),
      aorBarangays: input.accountType === 'station' ? [] : aorBarangays,

      createdAt:
        serverTimestamp(),

      lastLoginAt:
        null,
    };
    try {
      await runTransaction(db, async transaction => {
        const stationRef = stationId ? doc(db, 'stations', stationId) : null;
        const currentStation = stationRef ? await transaction.get(stationRef) : null;
        if (newStation && currentStation?.exists()) {
          throw new Error('That Station ID already exists.');
        }
        if (stationId && !newStation
          && (!currentStation?.exists() || currentStation.data().active !== true)) {
          throw new Error('Choose an active station from the station directory.');
        }

        if (newStation && stationRef) {
          transaction.set(stationRef, {
            name: newStation.name,
            active: true,
            createdAt: serverTimestamp(),
          });
        }
        if (input.accountType === 'station' && stationId) {
          transaction.set(stationAccountRef(stationId, cred.user.uid), profileData);
          transaction.set(stationAccountIndexRef(cred.user.uid), { stationId });
        } else {
          transaction.set(userProfileRef(cred.user.uid), profileData);
        }
      });
    } catch (error) {
      try {
        await deleteUser(cred.user);
      } catch (rollbackError) {
        console.error('Failed to remove the Auth account after its Firestore profile could not be created:', rollbackError);
        throw new Error('The Firestore profile could not be created, and the new sign-in account could not be rolled back. Contact an administrator.');
      }
      throw error;
    }

    await secondarySignOut(
      secondaryAuth,
    ).catch(() => {});
  } finally {
    await deleteApp(
      secondary,
    ).catch(() => {});
  }
}
