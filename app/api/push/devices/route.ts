import { createHash } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { adminApp } from '@/lib/firebase-admin';
import { canReceiveStationPush } from '@/functions/push-policy.mjs';

export const runtime = 'nodejs';

async function handle(request: Request, remove: boolean) {
  const response = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (Number(request.headers.get('content-length') ?? 0) > 8192) return response({ error: 'Request too large.' }, 413);
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return response({ error: 'Sign in required.' }, 401);
  let uid: string;
  try { uid = (await getAuth(adminApp()).verifyIdToken(authorization.slice(7), true)).uid; }
  catch { return response({ error: 'Sign in required.' }, 401); }
  let token: unknown;
  try { token = (await request.json()).token; }
  catch { return response({ error: 'Invalid request.' }, 400); }
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || /\s/.test(token)) return response({ error: 'Invalid device token.' }, 400);
  const db = getFirestore(adminApp());
  const ref = db.collection('pushDevices').doc(createHash('sha256').update(token).digest('hex'));
  try {
    if (remove) {
      await db.runTransaction(async transaction => {
        const device = await transaction.get(ref);
        if (device.get('uid') === uid) transaction.delete(ref);
      });
    } else {
      const index = await db.doc(`stationAccountIndex/${uid}`).get();
      const indexedStation = index.get('stationId');
      if (index.exists && (typeof indexedStation !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(indexedStation))) return response({ error: 'Invalid station assignment.' }, 403);
      const profile = index.exists
        ? (await db.doc(`stations/${indexedStation}/accounts/${uid}`).get()).data()
        : (await db.doc(`users/${uid}`).get()).data();
      const stationId = profile?.stationId;
      if ((index.exists && (profile?.uid !== uid || profile?.accountType !== 'station' || stationId !== indexedStation))
        || !canReceiveStationPush(profile, stationId)) return response({ error: 'Station management access required.' }, 403);
      await ref.set({ uid, token, stationId, updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60_000) });
    }
    return response({ ok: true });
  } catch {
    return response({ error: 'Could not save device notification settings.' }, 503);
  }
}

export async function POST(request: Request) { return handle(request, false); }
export async function DELETE(request: Request) { return handle(request, true); }
