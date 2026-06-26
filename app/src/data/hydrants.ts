// Hydrant view-model + Firestore adapter for the Hydro-Scout dashboard.
//
// Firestore stores hydrants in a different shape than the UI consumes
// (GeoPoint location, operationalStatus/pressureStatus strings, hazards[],
// inspector, a single notes string, etc.). `hydrantFromDoc` maps a raw
// Firestore document into the `Hydrant` view-model the components expect.

import type { DocumentData } from 'firebase/firestore';

export type HydrantStatus   = 'operational' | 'reduced' | 'out';
export type HydrantPressure = 'Strong' | 'Moderate' | 'Low' | 'None';
export type HydrantKey      = 'Required' | 'None';

export interface HydrantNote {
  user: string;
  initials: string;
  text: string;
  date: string;
}

export interface HydrantRegisterEntry {
  statusColor: string;
  action: string;
  by: string;
  role: string;
  date: string;
}

export interface Hydrant {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: HydrantStatus;
  pressure: HydrantPressure;
  key: HydrantKey;
  // Details
  type: string;
  mounting: string;
  keyWrench: string;
  area: string;
  outlets: number;
  color: string;
  concessionaire: string;
  landmark: string;
  hazard: string;
  distanceM: number;
  distanceMin: number;
  notes: HydrantNote[];
  register: HydrantRegisterEntry[];
  // Cloudinary secure URLs of field photos, oldest → newest.
  photos: string[];
}

export interface StatusMeta {
  color: string;
  iconUrl: string;
  legendLabel: string;
  pillLabel: string;
}

export const STATUS_META: Record<HydrantStatus, StatusMeta> = {
  operational: {
    color: '#2fbf4f',
    iconUrl: '/Hydrant%20Pin%20Gren.png',
    legendLabel: 'Operational',
    pillLabel: 'Operational',
  },
  reduced: {
    color: '#f5a623',
    iconUrl: '/Hydrant%20Pin%20Orange.png',
    legendLabel: 'Reduced Pressure',
    pillLabel: 'Low Pressure',
  },
  out: {
    color: '#9aa0a6',
    iconUrl: '/Hydrant%20Pin%20Gray.png',
    legendLabel: 'Out of Service',
    pillLabel: 'Out of Service',
  },
};

export const STATUS_ORDER: HydrantStatus[] = ['operational', 'reduced', 'out'];

export function countByStatus(hydrants: Hydrant[]): Record<HydrantStatus, number> {
  return hydrants.reduce(
    (acc, h) => { acc[h.status] += 1; return acc; },
    { operational: 0, reduced: 0, out: 0 } as Record<HydrantStatus, number>,
  );
}

/* ───────────────────────── Firestore mapping ───────────────────────── */

// Firestore operationalStatus → UI status
export function toStatus(operationalStatus: unknown): HydrantStatus {
  switch (String(operationalStatus ?? '').toLowerCase()) {
    case 'reduced pressure': return 'reduced';
    case 'out of service':   return 'out';
    default:                 return 'operational';
  }
}

// UI status → Firestore operationalStatus
export function toOperationalStatus(status: HydrantStatus): string {
  switch (status) {
    case 'reduced': return 'Reduced Pressure';
    case 'out':     return 'Out of Service';
    default:        return 'Operational';
  }
}

// Firestore pressureStatus → UI pressure label
function toPressure(pressureStatus: unknown): HydrantPressure {
  switch (String(pressureStatus ?? '').toLowerCase()) {
    case 'strong':   return 'Strong';
    case 'moderate': return 'Moderate';
    case 'weak':
    case 'low':      return 'Low';
    case 'out':
    case 'none':     return 'None';
    default:         return 'Moderate';
  }
}

// UI status → a sensible Firestore pressureStatus when one isn't supplied
export function statusToPressureStatus(status: HydrantStatus): string {
  switch (status) {
    case 'reduced': return 'Weak';
    case 'out':     return 'Out';
    default:        return 'Strong';
  }
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Firestore Timestamp | string | Date → "YYYY-MM-DD" (or '' when absent)
function toDateString(value: unknown): string {
  if (!value) return '';
  // Firestore Timestamp (client SDK) exposes toDate()
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try { return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10); }
    catch { /* fall through */ }
  }
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

// Pull [lat, lng] out of a GeoPoint, {latitude,longitude}, or {_lat,_long}.
function readLocation(loc: unknown): { lat: number; lng: number } {
  if (loc && typeof loc === 'object') {
    const o = loc as Record<string, number>;
    const lat = o.latitude ?? o._latitude ?? o.lat;
    const lng = o.longitude ?? o._longitude ?? o.lng;
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  }
  return { lat: 0, lng: 0 };
}

function deriveName(address: unknown, id: string): string {
  const a = typeof address === 'string' ? address.trim() : '';
  if (!a) return id;
  return a.split(',')[0].trim() || id;
}

function deriveArea(address: unknown): string {
  const a = typeof address === 'string' ? address.trim() : '';
  const parts = a.split(',').map((p) => p.trim()).filter(Boolean);
  return parts[1] ?? parts[0] ?? 'Quezon City';
}

interface StoredNote { user?: string; initials?: string; text?: string; date?: string }
interface StoredRegisterEntry { statusColor?: string; action?: string; by?: string; role?: string; date?: string }

// Maps a raw Firestore hydrant document → the UI `Hydrant` view-model.
export function hydrantFromDoc(id: string, d: DocumentData): Hydrant {
  const { lat, lng } = readLocation(d.location);
  const status = toStatus(d.operationalStatus);
  const inspector: string = d.inspector ?? 'Field Inspector';
  const inspectionDate = toDateString(d.dateInspected);

  const hazards: string[] = Array.isArray(d.hazards) ? d.hazards : [];

  const photos: string[] = Array.isArray(d.photos)
    ? d.photos.filter((p): p is string => typeof p === 'string')
    : [];

  // Notes: prefer a structured fieldNotes array; otherwise synthesize one
  // from the single seeded `notes` string + inspector.
  let notes: HydrantNote[] = [];
  if (Array.isArray(d.fieldNotes) && d.fieldNotes.length) {
    notes = (d.fieldNotes as StoredNote[]).map((n) => ({
      user: n.user ?? inspector,
      initials: n.initials ?? initialsOf(n.user ?? inspector),
      text: n.text ?? '',
      date: n.date ?? inspectionDate,
    }));
  } else if (typeof d.notes === 'string' && d.notes.trim()) {
    notes = [{ user: inspector, initials: initialsOf(inspector), text: d.notes.trim(), date: inspectionDate }];
  }

  // Register: prefer a stored array; otherwise synthesize the initial inspection.
  let register: HydrantRegisterEntry[] = [];
  if (Array.isArray(d.register) && d.register.length) {
    register = (d.register as StoredRegisterEntry[]).map((e) => ({
      statusColor: e.statusColor ?? STATUS_META[status].color,
      action: e.action ?? 'Status update',
      by: e.by ?? inspector,
      role: e.role ?? 'Authorized',
      date: e.date ?? inspectionDate,
    }));
  } else {
    register = [{
      statusColor: STATUS_META[status].color,
      action: 'Initial inspection',
      by: inspector,
      role: 'Authorized',
      date: inspectionDate,
    }];
  }

  return {
    id,
    name: deriveName(d.address, id),
    lat,
    lng,
    status,
    pressure: toPressure(d.pressureStatus),
    key: d.keyWrench && d.keyWrench !== 'None' ? 'Required' : (d.keyWrenchNeeded ? 'Required' : 'None'),
    type: d.sourceType ?? 'Fire Hydrant',
    mounting: d.mounting ?? 'Above ground',
    keyWrench: d.keyWrench ?? (d.keyWrenchNeeded ? 'Required' : 'None'),
    area: deriveArea(d.address),
    outlets: typeof d.outletCount === 'number' ? d.outletCount : 0,
    color: d.hydrantColor ?? 'Unspecified',
    concessionaire: d.ownershipJurisdiction ?? 'Unspecified',
    landmark: d.nearestLandmark || (typeof d.address === 'string' && d.address) || '—',
    hazard: hazards.length ? hazards.join(', ') : 'None',
    distanceM: 0,
    distanceMin: 0,
    notes,
    register,
    photos,
  };
}
