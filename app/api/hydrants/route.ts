// app/api/hydrants/route.ts
//
// POST: create a hydrant. Firestore rules deny client creates because they
// cannot check geometry: here the barangay is derived from the coordinates
// (lib/qc-barangays.json) and non-admins must be inside their own station's
// Area of Responsibility (stations/{id}.aorBarangays). Every later edit is
// AOR-checked by the rules against the barangay stored here.

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, GeoPoint, getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import { verifiedProfile } from '@/lib/server-profile';
import { barangayAt, type BarangayCollection } from '@/lib/barangay-boundaries';
import { aorStationIdForProfile, readAorBarangays } from '@/lib/station-aor';
import boundaries from '@/lib/qc-barangays.json';
import { STATUS_META, statusToPressureStatus, toOperationalStatus, type HydrantStatus } from '@/app/src/data/hydrants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const ROLE_LABELS: Record<string, string> = { authorized: 'Authorized User', head: 'Head', admin: 'Admin' };
const STATUSES = new Set<HydrantStatus>(['operational', 'reduced', 'out']);

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseInput(body: DocumentData) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const address = text(body.address, 300);
  if (!address || !STATUSES.has(body.status)) return null;
  const photos: unknown[] = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length > 20 || photos.some(url => typeof url !== 'string' || url.length > 1000 || !url.startsWith('https://'))) return null;
  const outlets = Number(body.outlets);
  return {
    lat, lng, address, status: body.status as HydrantStatus, photos: photos as string[],
    landmark: text(body.landmark, 200), concessionaire: text(body.concessionaire, 120),
    waterCleanliness: text(body.waterCleanliness, 60), hazard: text(body.hazard, 300),
    type: text(body.type, 60), mounting: text(body.mounting, 60), keyWrench: text(body.keyWrench, 60),
    color: text(body.color, 40), note: text(body.note, 2000),
    outlets: Number.isInteger(outlets) && outlets >= 0 && outlets <= 12 ? outlets : 2,
  };
}

export async function POST(req: NextRequest) {
  // Cookie-authenticated writes must come from this origin.
  if (req.headers.get('origin') !== req.nextUrl.origin) return reply({ error: 'Invalid origin.' }, 403);
  const session = req.cookies.get('session')?.value;
  if (!session) return reply({ error: 'Authentication required.' }, 401);

  let app;
  try { app = adminApp(); } catch (error) {
    console.error('Hydrant creation unavailable: Firebase Admin failed to initialize.', error);
    return reply({ error: 'Hydrant service unavailable. Please try again later.' }, 503);
  }
  let uid: string;
  try {
    uid = (await getAuth(app).verifySessionCookie(session, true)).uid;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string' && code.startsWith('auth/')) return reply({ error: 'Authentication required.' }, 401);
    console.error('Hydrant creation could not verify the session.', error);
    return reply({ error: 'Hydrant service unavailable. Please try again later.' }, 503);
  }

  let body: DocumentData;
  try { body = await req.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
  const input = parseInput(body ?? {});
  if (!input) return reply({ error: 'Enter a valid location, address and status.' }, 400);

  try {
    const db = getFirestore(app);
    const profile = await verifiedProfile(db, uid);
    const isStation = profile.accountType === 'station';
    const role = isStation ? 'head' : profile.role;
    const isAdmin = role === 'admin' && !isStation;
    if (!['authorized', 'head', 'admin'].includes(role)) return reply({ error: 'You do not have permission to pin a hydrant.' }, 403);

    const barangay = barangayAt(boundaries as BarangayCollection, input.lat, input.lng);
    if (!isAdmin) {
      const stationId = aorStationIdForProfile(profile);
      const station = stationId ? (await db.doc(`stations/${stationId}`).get()).data() : undefined;
      if (!stationId || station?.active !== true) {
        return reply({ error: 'Only approved members of an active station can pin hydrants.' }, 403);
      }
      if (!barangay || !readAorBarangays(station.aorBarangays).includes(barangay)) {
        const where = barangay ? `Barangay ${barangay}` : 'This location';
        return reply({ error: `${where} is outside ${station.name || stationId}'s area of responsibility.`, barangay }, 403);
      }
    }

    const by = text(profile.displayName, 120) || 'Responder';
    const roleLabel = isStation ? 'Station Account' : ROLE_LABELS[role] ?? role;
    const actorStationId = typeof profile.stationId === 'string' ? profile.stationId : null;
    const dateStr = new Date().toISOString().slice(0, 10);
    const id = await db.runTransaction(async tx => {
      // First unoccupied HYD-### slot, matching the previous client allocation.
      let hydrantId: string | null = null;
      for (let i = 1; i <= 500 && !hydrantId; i++) {
        const candidate = `HYD-${String(i).padStart(3, '0')}`;
        if (!(await tx.get(db.doc(`hydrants/${candidate}`))).exists) hydrantId = candidate;
      }
      if (!hydrantId) throw new Error('No hydrant IDs are available.');
      tx.set(db.doc(`hydrants/${hydrantId}`), {
        location: new GeoPoint(input.lat, input.lng),
        barangay,
        address: input.address,
        operationalStatus: toOperationalStatus(input.status),
        pressureStatus: statusToPressureStatus(input.status),
        waterCleanliness: input.waterCleanliness,
        hazards: input.hazard ? input.hazard.split(',').map(h => h.trim()).filter(Boolean) : [],
        inspector: by,
        notes: input.note,
        fieldNotes: input.note ? [{
          user: by, initials: by.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          text: input.note, date: dateStr,
        }] : [],
        register: [{
          statusColor: STATUS_META[input.status].color,
          action: `Hydrant pinned as ${toOperationalStatus(input.status)}`,
          by, role: roleLabel, date: dateStr,
        }],
        sourceType: input.type || 'Pillar',
        mounting: input.mounting || 'Above Ground',
        keyWrench: input.keyWrench || 'None',
        outletCount: input.outlets || 2,
        hydrantColor: input.color || 'Red',
        ownershipJurisdiction: input.concessionaire || 'MWSS',
        nearestLandmark: input.landmark,
        photos: input.photos,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: by,
      });
      if (actorStationId) {
        tx.set(db.collection(`stations/${actorStationId}/notifications`).doc(), {
          type: 'hydrant-pinned', uid, displayName: by, hydrantId, lat: input.lat, lng: input.lng,
          message: `${by} pinned hydrant ${hydrantId}.`, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return hydrantId;
    });
    return reply({ id, barangay }, 201);
  } catch (error) {
    console.error('Could not create hydrant:', error);
    return reply({ error: 'Could not save the hydrant. Please try again.' }, 503);
  }
}
