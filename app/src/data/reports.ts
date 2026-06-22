// Report view-model + Firestore adapter.
//
// Reports live in a `reports` subcollection under each hydrant
// (hydrants/{id}/reports/{reportId}). The ReportsPanel reads them across all
// hydrants via a collectionGroup query.

import type { DocumentData } from 'firebase/firestore';

export type ReportStatus = 'pending' | 'resolved' | 'denied';

export interface Report {
  id: string;          // display ID (reportNo or Firestore doc ID)
  firestoreId: string; // raw Firestore doc ID — used for status updates
  hydrantId: string;
  title: string;
  location: string;
  reporter: string;
  role: string;
  date: string;
  time: string;
  status: ReportStatus;
}

export const STATUS_COLORS: Record<ReportStatus, { border: string; badge: string; text: string; label: string }> = {
  pending:  { border: '#f5a623', badge: '#fff4e0', text: '#c97a00', label: 'Pending'  },
  resolved: { border: '#2fbf4f', badge: '#e6f9ec', text: '#1e8a39', label: 'Resolved' },
  denied:   { border: '#91191E', badge: '#fce8e9', text: '#91191E', label: 'Denied'   },
};

function toStatus(value: unknown): ReportStatus {
  const v = String(value ?? '').toLowerCase();
  if (v === 'resolved' || v === 'denied') return v;
  return 'pending';
}

// Firestore createdAt Timestamp | string → { date, time }
function toDateTime(value: unknown, fallbackDate?: string, fallbackTime?: string): { date: string; time: string } {
  let d: Date | null = null;
  if (value && typeof value === 'object' && 'toDate' in value) {
    try { d = (value as { toDate: () => Date }).toDate(); } catch { /* ignore */ }
  } else if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }
  if (d) {
    return {
      date: d.toISOString().slice(0, 10),
      time: d.toTimeString().slice(0, 5),
    };
  }
  return { date: fallbackDate ?? '—', time: fallbackTime ?? '' };
}

// Maps a raw Firestore report document → the UI `Report` view-model.
export function reportFromDoc(id: string, hydrantId: string, d: DocumentData): Report {
  const { date, time } = toDateTime(d.createdAt, d.date, d.time);
  const title = d.title ?? d.damageType ?? 'Reported issue';
  return {
    id: d.reportNo ?? id,
    firestoreId: id,
    hydrantId,
    title,
    location: d.location ?? '—',
    reporter: d.reporter ?? 'Unknown',
    role: d.role ?? 'Authorized User',
    date,
    time,
    status: toStatus(d.status),
  };
}
