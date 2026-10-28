import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import { limitedNotificationFeed, notificationProfile, serializeLimitedNotification } from '@/lib/limited-notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
const idPattern = /^[a-f0-9]{64}$/;
// Binds a receipt ID to the verified session that was shown it, so POST can
// save a receipt without rebuilding the whole feed (~100+ reads per click).
const receiptToken = (session: string, uid: string, id: string) => createHmac('sha256', session).update(`${uid}:${id}`).digest('hex');
// All of a viewer's receipts live in one document: one read per poll instead
// of one billed read per notification (missing receipts are billed too).
const readStateRef = (db: Firestore, uid: string) => db.doc(`users/${uid}/notificationReadState/current`);
const MAX_STORED_READS = 1000;

async function viewer(req: NextRequest, loadProfile = true) {
  const session = req.cookies.get('session')?.value;
  if (!session) return null;
  try {
    const app = adminApp();
    const decoded = await getAuth(app).verifySessionCookie(session, true);
    const db = getFirestore(app);
    if (!loadProfile) return { db, uid: decoded.uid, session, profile: null };
    const profile = await notificationProfile(db, decoded.uid);
    if (!['person', 'station'].includes(profile.accountType)) return null;
    return { db, uid: decoded.uid, session, profile };
  } catch { return null; }
}

async function readIds(db: Firestore, uid: string, itemIds: string[]) {
  const ref = readStateRef(db, uid);
  const state = (await ref.get()).data();
  let ids: string[] = Array.isArray(state?.ids) ? state.ids.filter((id: unknown): id is string => typeof id === 'string') : [];
  if (state?.migrated !== true) {
    // One-time import of legacy per-notification receipt documents.
    const legacy = itemIds.length ? await db.getAll(...itemIds.map(id => db.doc(`users/${uid}/notificationReads/${id}`))) : [];
    const found = legacy.filter(record => record.exists).map(record => record.id);
    // arrayUnion rejects zero arguments; merge keeps any receipt POSTed first.
    await ref.set({ ...(found.length ? { ids: FieldValue.arrayUnion(...found) } : {}), migrated: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    ids = [...new Set([...ids, ...found])];
  } else if (ids.length > MAX_STORED_READS) {
    // Receipts for notifications that left the feed can never match again.
    const current = new Set(itemIds);
    ids = ids.filter(id => current.has(id));
    await ref.set({ ids, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return ids;
}

export async function GET(req: NextRequest) {
  const account = await viewer(req);
  if (!account?.profile) return reply({ error: 'Authentication required.' }, 401);
  try {
    const items = await limitedNotificationFeed(account.db, account.uid, account.profile);
    const itemIds = items.map(item => item.id);
    const read = new Set(await readIds(account.db, account.uid, itemIds));
    return reply({
      viewerUid: account.uid,
      notifications: items.map(serializeLimitedNotification),
      readIds: itemIds.filter(id => read.has(id)),
      receiptTokens: Object.fromEntries(itemIds.map(id => [id, receiptToken(account.session, account.uid, id)])),
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
  if (typeof id !== 'string' || !idPattern.test(id) || typeof token !== 'string' || !idPattern.test(token)) {
    return reply({ error: 'Invalid notification.' }, 400);
  }
  const expected = Buffer.from(receiptToken(account.session, account.uid, id), 'hex');
  if (!timingSafeEqual(Buffer.from(token, 'hex'), expected)) return reply({ error: 'Notification unavailable.' }, 404);
  try {
    await readStateRef(account.db, account.uid).set({ ids: FieldValue.arrayUnion(id), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return reply({ ok: true });
  } catch (error) {
    console.error('Could not save limited notification read status:', error);
    return reply({ error: 'Could not save read status.' }, 503);
  }
}
