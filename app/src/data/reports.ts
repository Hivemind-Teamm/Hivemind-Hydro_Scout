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
  denied:   { border: '#e0353b', badge: '#fce8e9', text: '#e0353b', label: 'Denied'   },
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

// Builds a clean, human-readable report reference (e.g. "RPT-3JMTH67") instead
// of exposing the raw Firestore document key. Prefers an explicit reportNo when
// one was assigned; otherwise derives a stable, professional-looking code from
// the document id so the Reports register never shows a database key.
function displayReportId(reportNo: unknown, firestoreId: string): string {
  if (reportNo !== undefined && reportNo !== null && String(reportNo).trim()) {
    return String(reportNo);
  }
  const slug = firestoreId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(-7);
  return `RPT-${slug || firestoreId.toUpperCase()}`;
}

// Maps a raw Firestore report document → the UI `Report` view-model.
export function reportFromDoc(id: string, hydrantId: string, d: DocumentData): Report {
  const { date, time } = toDateTime(d.createdAt, d.date, d.time);
  const title = d.title ?? d.damageType ?? 'Reported issue';
  return {
    id: displayReportId(d.reportNo, id),
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
