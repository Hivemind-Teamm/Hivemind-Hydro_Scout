'use client';

// Firestore data layer for Hydro-Scout: live subscriptions (read) and
// mutations (edit hydrant status, file damage report). Reads are public;
// writes require a signed-in user with an appropriate role (enforced by
// firestore.rules).

import { useEffect, useState } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  updateDoc,
  addDoc,
  runTransaction,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  query,
  orderBy,
  GeoPoint,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  hydrantFromDoc,
  toOperationalStatus,
  statusToPressureStatus,
  STATUS_META,
  type Hydrant,
  type HydrantStatus,
} from './hydrants';
import { reportFromDoc, type Report } from './reports';

/* ───────────────────────────── Hydrants ───────────────────────────── */

export interface HydrantsState {
  hydrants: Hydrant[];
  loading: boolean;
  error: string | null;
}

export function useHydrants(): HydrantsState {
  const [hydrants, setHydrants] = useState<Hydrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'hydrants'),
      (snap) => {
        const list = snap.docs
          .map((d) => hydrantFromDoc(d.id, d.data()))
          // Drop docs without usable coordinates so they don't pile up at 0,0.
          .filter((h) => h.lat !== 0 || h.lng !== 0);
        setHydrants(list);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load hydrants:', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { hydrants, loading, error };
}

export interface EditHydrantInput {
  status: HydrantStatus;
  waterCleanliness?: string;
  hazard?: string;
  note?: string;
  by: string;
  role: string;
  photos?: string[]; // Cloudinary URLs to append to the hydrant's photo set
}

// Writes an authorized status edit to Firestore: updates the operational/
// pressure fields and appends to the register (+ a field note when present).
export async function updateHydrantStatus(hydrantId: string, input: EditHydrantInput): Promise<void> {
  const ref = doc(db, 'hydrants', hydrantId);
  const nowIso = new Date().toISOString();
  const dateStr = nowIso.slice(0, 10);

  const payload: Record<string, unknown> = {
    operationalStatus: toOperationalStatus(input.status),
    pressureStatus: statusToPressureStatus(input.status),
    updatedBy: input.by,
    updatedAt: serverTimestamp(),
    register: arrayUnion({
      statusColor: STATUS_META[input.status].color,
      action: `Status set to ${toOperationalStatus(input.status)}`,
      by: input.by,
      role: input.role,
      date: dateStr,
    }),
  };

  if (input.waterCleanliness?.trim()) payload.waterCleanliness = input.waterCleanliness.trim();
  if (input.hazard?.trim()) payload.hazards = input.hazard.split(',').map((h) => h.trim()).filter(Boolean);
  if (input.photos?.length) payload.photos = arrayUnion(...input.photos);
  if (input.note?.trim()) {
    payload.fieldNotes = arrayUnion({
      user: input.by,
      initials: input.by.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      text: input.note.trim(),
      date: dateStr,
    });
  }

  await updateDoc(ref, payload);
}

/* ───────────────────────────── Reports ────────────────────────────── */

export interface ReportsState {
  reports: Report[];
  loading: boolean;
  error: string | null;
}

export function useReports(): ReportsState {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // collectionGroup gathers the `reports` subcollection across every hydrant.
    const unsub = onSnapshot(
      collectionGroup(db, 'reports'),
      (snap) => {
        const list = snap.docs.map((d) => {
          // parent.parent is the hydrant document
          const hydrantId = d.ref.parent.parent?.id ?? '—';
          return reportFromDoc(d.id, hydrantId, d.data());
        });
        // newest first by date+time string
        list.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
        setReports(list);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load reports:', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  return { reports, loading, error };
}

export interface CreateReportInput {
  title: string;          // damage type / short title
  description: string;
  location: string;       // hydrant name / address
  reporter: string;
  role: string;
}

// Files a damage report into hydrants/{id}/reports.
export async function createReport(hydrantId: string, input: CreateReportInput): Promise<void> {
  const ref = collection(db, 'hydrants', hydrantId, 'reports');
  await addDoc(ref, {
    title: input.title,
    description: input.description,
    location: input.location,
    reporter: input.reporter,
    role: input.role,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

/* ───────────────────────────── Create hydrant ──────────────────────────── */

export interface CreateHydrantInput {
  lat: number;
  lng: number;
  address: string;
  landmark: string;
  concessionaire: string;
  status: HydrantStatus;
  waterCleanliness: string;
  hazard: string;
  type: string;
  mounting: string;
  keyWrench: string;
  outlets: number;
  color: string;
  note: string;
  by: string;
  role: string;
  photos?: string[];
}

export async function createHydrant(input: CreateHydrantInput): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);

  await runTransaction(db, async (tx) => {
    // Scan from HYD-001 upward and take the first unoccupied slot.
    // This naturally fills gaps left by deleted hydrants.
    let hydrantRef!: ReturnType<typeof doc>;
    for (let i = 1; i <= 500; i++) {
      const id = `HYD-${String(i).padStart(3, '0')}`;
      hydrantRef = doc(db, 'hydrants', id);
      const snap = await tx.get(hydrantRef);
      if (!snap.exists()) break;
    }

    tx.set(hydrantRef, {
      location: new GeoPoint(input.lat, input.lng),
      address: input.address,
      operationalStatus: toOperationalStatus(input.status),
      pressureStatus: statusToPressureStatus(input.status),
      waterCleanliness: input.waterCleanliness || '',
      hazards: input.hazard ? input.hazard.split(',').map(h => h.trim()).filter(Boolean) : [],
      inspector: input.by,
      notes: input.note || '',
      fieldNotes: input.note ? [{
        user: input.by,
        initials: input.by.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        text: input.note,
        date: dateStr,
      }] : [],
      register: [{
        statusColor: STATUS_META[input.status].color,
        action: `Hydrant pinned as ${toOperationalStatus(input.status)}`,
        by: input.by,
        role: input.role,
        date: dateStr,
      }],
      sourceType: input.type || 'Pillar',
      mounting: input.mounting || 'Above Ground',
      keyWrench: input.keyWrench || 'None',
      outletCount: input.outlets || 2,
      hydrantColor: input.color || 'Red',
      ownershipJurisdiction: input.concessionaire || 'MWSS',
      nearestLandmark: input.landmark || '',
      photos: input.photos ?? [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: input.by,
    });
  });
}

// Removes a single photo URL from a hydrant's photo array (head / admin only).
export async function deleteHydrantPhoto(hydrantId: string, photoUrl: string): Promise<void> {
  const ref = doc(db, 'hydrants', hydrantId);
  await updateDoc(ref, { photos: arrayRemove(photoUrl) });
}

// Moves a photo to index 0 so it becomes the display photo in the mini panel.
export async function setDisplayPhoto(hydrantId: string, photoUrl: string, allPhotos: string[]): Promise<void> {
  const reordered = [photoUrl, ...allPhotos.filter((p) => p !== photoUrl)];
  const ref = doc(db, 'hydrants', hydrantId);
  await updateDoc(ref, { photos: reordered });
}

// Updates a report's status (head / admin only — enforced by Firestore rules).
export async function updateReportStatus(
  hydrantId: string,
  firestoreId: string,
  status: 'resolved' | 'denied',
): Promise<void> {
  const ref = doc(db, 'hydrants', hydrantId, 'reports', firestoreId);
  await updateDoc(ref, { status });
}

// Unused but exported for callers that want an ordered hydrant query later.
export function hydrantsQuery() {
  return query(collection(db, 'hydrants'), orderBy('recordNo'));
}
