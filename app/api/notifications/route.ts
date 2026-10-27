import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import { limitedNotificationFeed, notificationProfile, serializeLimitedNotification } from '@/lib/limited-notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
const receiptToken = (session: string, id: string) => createHmac('sha256', session).update(id).digest('hex');

async function viewer(req: NextRequest, loadProfile = true) {
  const session = req.cookies.get('session')?.value;
  if (!session) return null;
  try {
    const app = adminApp();
    const decoded = await getAuth(app).verifySessionCookie(session, true);
    const db = getFirestore(app);
    if (!loadProfile) return { db, uid: decoded.uid, profile: null, session };
    const profile = await notificationProfile(db, decoded.uid);
    if (!['person', 'station'].includes(profile.accountType)) return null;
    return { db, uid: decoded.uid, profile, session };
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const account = await viewer(req);
  if (!account) return reply({ error: 'Authentication required.' }, 401);
  if (!account.profile) return reply({ error: 'Authentication required.' }, 401);
  try {
    const items = await limitedNotificationFeed(account.db, account.uid, account.profile);
    // Reading every possible receipt by ID bills one document read even when
    // the receipt does not exist. Query the viewer's recent receipts once.
    const receipts = await account.db.collection(`users/${account.uid}/notificationReads`)
      .orderBy('readAt', 'desc').limit(200).get();
    return reply({
      viewerUid: account.uid,
      notifications: items.map(serializeLimitedNotification),
      readIds: receipts.docs.map(record => record.id),
      receiptTokens: Object.fromEntries(items.map(item => [item.id, receiptToken(account.session, item.id)])),
    });
  } catch (error) {
    console.error('Could not load limited notifications:', error);
    return reply({ error: 'Could not load notifications. Please try again.' }, 503);
  }
}

export async function POST(req: NextRequest) {
  // Cookie-authenticated writes must come from this origin.
  if (req.headers.get('origin') !== req.nextUrl.origin) return reply({ error: 'Invalid origin.' }, 403);
  const account = await viewer(req, false);
  if (!account) return reply({ error: 'Authentication required.' }, 401);
  let id: unknown;
  let token: unknown;
  try { ({ id, token } = await req.json()); } catch { return reply({ error: 'Invalid request.' }, 400); }
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)
    || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return reply({ error: 'Invalid notification.' }, 400);
  const supplied = Buffer.from(token, 'hex');
  const expected = Buffer.from(receiptToken(account.session, id), 'hex');
  if (!timingSafeEqual(supplied, expected)) return reply({ error: 'Notification unavailable.' }, 404);
  try {
    // A read receipt is private, belongs to the verified viewer, and grants no
    // access. Rebuilding the complete feed merely to save that preference was
    // an expensive duplicate of GET and is unnecessary for authorization.
    await account.db.doc(`users/${account.uid}/notificationReads/${id}`).set({ readAt: FieldValue.serverTimestamp() });
    return reply({ ok: true });
  } catch (error) {
    console.error('Could not save limited notification read status:', error);
    return reply({ error: 'Could not save read status.' }, 503);
  }
}
