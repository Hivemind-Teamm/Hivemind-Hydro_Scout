import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import { limitedNotificationFeed, notificationProfile, serializeLimitedNotification } from '@/lib/limited-notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });

async function viewer(req: NextRequest) {
  const session = req.cookies.get('session')?.value;
  if (!session) return null;
  try {
    const app = adminApp();
    const decoded = await getAuth(app).verifySessionCookie(session, true);
    const db = getFirestore(app);
    const profile = await notificationProfile(db, decoded.uid);
    if (!['person', 'station'].includes(profile.accountType)) return null;
    return { db, uid: decoded.uid, profile };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const account = await viewer(req);
  if (!account) return reply({ error: 'Authentication required.' }, 401);
  try {
    const items = await limitedNotificationFeed(account.db, account.uid, account.profile);
    const refs = items.map(item => account.db.doc(`users/${account.uid}/notificationReads/${item.id}`));
    const receipts = refs.length ? await account.db.getAll(...refs) : [];
    return reply({ viewerUid: account.uid, notifications: items.map(serializeLimitedNotification), readIds: receipts.filter(record => record.exists).map(record => record.id) });
  } catch (error) {
    console.error('Could not load limited notifications:', error);
    return reply({ error: 'Could not load notifications. Please try again.' }, 503);
  }
}

export async function POST(req: NextRequest) {
  // Cookie-authenticated writes must come from this origin.
  if (req.headers.get('origin') !== req.nextUrl.origin) return reply({ error: 'Invalid origin.' }, 403);
  const account = await viewer(req);
  if (!account) return reply({ error: 'Authentication required.' }, 401);
  let id: unknown;
  try { id = (await req.json()).id; } catch { return reply({ error: 'Invalid request.' }, 400); }
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return reply({ error: 'Invalid notification.' }, 400);
  try {
    const items = await limitedNotificationFeed(account.db, account.uid, account.profile);
    if (!items.some(item => item.id === id)) return reply({ error: 'Notification unavailable.' }, 404);
    await account.db.doc(`users/${account.uid}/notificationReads/${id}`).set({ readAt: FieldValue.serverTimestamp() });
    return reply({ ok: true });
  } catch (error) {
    console.error('Could not save limited notification read status:', error);
    return reply({ error: 'Could not save read status.' }, 503);
  }
}
