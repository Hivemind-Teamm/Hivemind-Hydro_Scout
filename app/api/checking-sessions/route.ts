import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import { verifiedProfile } from '@/lib/server-profile';
import { aorStationIdForProfile, readAorBarangays } from '@/lib/station-aor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const sessionIdPattern = /^[A-Za-z0-9]{20}$/;

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function viewer(req: NextRequest) {
  const session = req.cookies.get('session')?.value;
  if (!session) return { error: reply({ error: 'Authentication required.' }, 401) } as const;
  let app;
  try { app = adminApp(); } catch (error) {
    console.error('Hydrant checking service could not initialize Firebase Admin.', error);
    return { error: reply({ error: 'Hydrant checking is temporarily unavailable.' }, 503) } as const;
  }
  let uid: string;
  try { uid = (await getAuth(app).verifySessionCookie(session, true)).uid; } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string' && code.startsWith('auth/')) return { error: reply({ error: 'Authentication required.' }, 401) } as const;
    console.error('Hydrant checking could not verify the session.', error);
    return { error: reply({ error: 'Hydrant checking is temporarily unavailable.' }, 503) } as const;
  }
  const db = getFirestore(app);
  const profile = await verifiedProfile(db, uid);
  const stationId = aorStationIdForProfile(profile);
  const isStationAccount = profile.accountType === 'station';
  const canRecord = isStationAccount || (profile.accountType === 'person'
    && profile.stationMembershipStatus === 'approved' && ['authorized', 'head'].includes(profile.role));
  const canManage = isStationAccount || (profile.accountType === 'person'
    && profile.stationMembershipStatus === 'approved' && profile.role === 'head');
  const displayName = text(profile.displayName, 120) || 'Responder';
  return { db, uid, stationId, canRecord, canManage, displayName } as const;
}

async function activeStation(db: ReturnType<typeof getFirestore>, stationId: string | null) {
  if (!stationId) return null;
  const record = await db.doc(`stations/${stationId}`).get();
  if (!record.exists || record.data()?.active !== true) return null;
  return record;
}

function checkSummary(items: FirebaseFirestore.QuerySnapshot, targetIds: string[]) {
  const target = new Set(targetIds);
  const checks = items.docs.filter(item => target.has(item.id));
  const statuses = checks.map(item => item.data().status);
  return {
    checkedCount: checks.length,
    pendingCount: Math.max(0, targetIds.length - checks.length),
    followUpCount: statuses.filter(status => status === 'follow-up').length,
    skippedCount: statuses.filter(status => status === 'skipped').length,
  };
}

export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== req.nextUrl.origin) return reply({ error: 'Invalid origin.' }, 403);
  let body: DocumentData;
  try { body = await req.json(); } catch { return reply({ error: 'Invalid request.' }, 400); }
  const account = await viewer(req);
  if ('error' in account) return account.error;

  try {
    const station = await activeStation(account.db, account.stationId);
    if (!station) return reply({ error: 'Your account is not assigned to an active station.' }, 403);
    const stationId = account.stationId!;
    if (body.action === 'start') {
      if (!account.canManage) return reply({ error: 'Only station management can start hydrant checking.' }, 403);
      const name = text(body.name, 120);
      if (!name) return reply({ error: 'Enter a name for this checking session.' }, 400);
      const active = await account.db.collection(`stations/${stationId}/checkingSessions`).where('status', '==', 'active').limit(1).get();
      if (!active.empty) return reply({ error: 'A hydrant checking session is already active for this station.' }, 409);

      const aor = new Set(readAorBarangays(station.data()?.aorBarangays));
      const hydrants = await account.db.collection('hydrants').get();
      // BFP reference records appear on the map for situational awareness but
      // are not verified operational hydrants, so they must not inflate a
      // station's checking coverage or block completion of a session.
      const targetHydrantIds = hydrants.docs
        .filter(item => aor.has(item.data().barangay)
          && item.data().referenceOnly !== true
          && item.data().operationalStatus !== 'BFP Reference')
        .map(item => item.id)
        .sort();
      if (!targetHydrantIds.length) return reply({ error: 'This station has no hydrants in its area of responsibility.' }, 409);
      const session = account.db.collection(`stations/${stationId}/checkingSessions`).doc();
      const notification = account.db.doc(`stations/${stationId}/notifications/hydrant-checking-${session.id}`);
      const message = `${account.displayName} started hydrant checking: ${name}.`;
      const now = FieldValue.serverTimestamp();
      const batch = account.db.batch();
      batch.set(session, { stationId, name, status: 'active', targetHydrantIds, targetHydrantCount: targetHydrantIds.length,
        startedAt: now, startedByUid: account.uid, startedByName: account.displayName });
      batch.set(notification, { type: 'hydrant-checking', uid: account.uid, displayName: account.displayName, message, createdAt: now,
        updatedAt: now, sessionId: session.id, checkingStatus: 'active', checkingName: name, targetHydrantCount: targetHydrantIds.length,
        checkedCount: 0, pendingCount: targetHydrantIds.length, followUpCount: 0, skippedCount: 0, startedAt: now, startedByUid: account.uid, startedByName: account.displayName });
      await batch.commit();
      return reply({ ok: true, sessionId: session.id }, 201);
    }

    if (body.action !== 'complete' || typeof body.sessionId !== 'string' || !sessionIdPattern.test(body.sessionId)) return reply({ error: 'Invalid request.' }, 400);
    if (!account.canRecord) return reply({ error: 'You do not have permission to record hydrant checks.' }, 403);
    const session = account.db.doc(`stations/${stationId}/checkingSessions/${body.sessionId}`);
    const [sessionRecord, items] = await Promise.all([session.get(), session.collection('items').get()]);
    if (!sessionRecord.exists || sessionRecord.data()?.stationId !== stationId) return reply({ error: 'Checking session not found.' }, 404);
    if (sessionRecord.data()?.status === 'completed') return reply({ ok: true, alreadyCompleted: true });
    const targetHydrantIds = Array.isArray(sessionRecord.data()?.targetHydrantIds)
      ? sessionRecord.data()!.targetHydrantIds.filter((id: unknown): id is string => typeof id === 'string') : [];
    if (!targetHydrantIds.length) return reply({ error: 'This session has no recorded hydrant coverage.' }, 409);
    const summary = checkSummary(items, targetHydrantIds);
    if (summary.pendingCount) return reply({ error: 'Hydrant checking is still in progress.', ...summary }, 409);

    const notification = account.db.doc(`stations/${stationId}/notifications/hydrant-checking-${session.id}`);
    await account.db.runTransaction(async transaction => {
      const latest = await transaction.get(session);
      if (!latest.exists || latest.data()?.status === 'completed') return;
      transaction.update(session, { status: 'completed', endedAt: FieldValue.serverTimestamp(), endedByUid: account.uid, endedByName: account.displayName, ...summary });
      transaction.update(notification, { message: `${account.displayName} completed hydrant checking: ${latest.data()?.name || 'Hydrant checking'}.`,
        checkingStatus: 'completed', endedAt: FieldValue.serverTimestamp(), endedByUid: account.uid, endedByName: account.displayName,
        updatedAt: FieldValue.serverTimestamp(), ...summary });
    });
    return reply({ ok: true, completed: true, ...summary });
  } catch (error) {
    console.error('Could not manage hydrant checking:', error);
    return reply({ error: 'Could not update hydrant checking. Please try again.' }, 503);
  }
}
