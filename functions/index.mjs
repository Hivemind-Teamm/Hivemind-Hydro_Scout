import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { canReceiveStationPush, stationPushContent } from './push-policy.mjs';

initializeApp();
const db = getFirestore();

async function currentProfile(uid) {
  const index = await db.doc(`stationAccountIndex/${uid}`).get();
  if (index.exists) {
    const stationId = index.get('stationId');
    if (typeof stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) return null;
    const account = await db.doc(`stations/${stationId}/accounts/${uid}`).get();
    const data = account.data();
    return data?.uid === uid && data.accountType === 'station' && data.stationId === stationId ? data : null;
  }
  return (await db.doc(`users/${uid}`).get()).data() ?? null;
}

async function deliver(stationId, kind, noticeId, type) {
  const content = stationPushContent(kind, type);
  if (!content || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) return;
  const profiles = new Map();
  let cursor;
  let retryNeeded = false;
  for (;;) {
    let query = db.collection('pushDevices').where('stationId', '==', stationId).orderBy('__name__').limit(400);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const eligible = [];
    for (const record of page.docs) {
      const device = record.data();
      if (typeof device.uid !== 'string' || !device.uid || device.uid.includes('/')
        || typeof device.token !== 'string' || device.expiresAt?.toMillis?.() <= Date.now()
        || !device.expiresAt?.toMillis) continue;
      if (!profiles.has(device.uid)) profiles.set(device.uid, await currentProfile(device.uid));
      if (canReceiveStationPush(profiles.get(device.uid), stationId)) eligible.push({ record, device });
    }
    if (eligible.length) {
      const result = await getMessaging().sendEach(eligible.map(({ device }) => ({
        token: device.token,
        data: { title: content.title, body: content.body, uid: device.uid, kind, noticeId,
          tag: `${stationId}:${kind}:${noticeId}` },
        webpush: { headers: { Urgency: content.urgency, TTL: '300' } },
      })));
      await Promise.all(result.responses.map(async (response, i) => {
        if (response.success) return;
        const code = response.error?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          // Registration can change ownership during delivery; never remove a newer registration.
          await db.runTransaction(async transaction => {
            const ref = eligible[i].record.ref;
            const latest = await transaction.get(ref);
            if (latest.get('uid') === eligible[i].device.uid && latest.get('token') === eligible[i].device.token) transaction.delete(ref);
          });
        } else {
          console.error('Push delivery failed', code); // Never log tokens or profile data.
          retryNeeded = true;
        }
      }));
    }
    cursor = page.docs.at(-1);
    if (page.size < 400) break;
  }
  // Firestore events are at-least-once. Stable browser tags coalesce duplicate alerts.
  if (retryNeeded) throw new Error('push-delivery-retry');
}

export const stationActivityPush = onDocumentCreated({
  document: 'stations/{stationId}/notifications/{noticeId}', region: 'asia-southeast1', retry: true,
}, async event => {
  if (Date.now() - Date.parse(event.time) > 5 * 60_000) return; // Never replay old operational alerts.
  await deliver(event.params.stationId, 'activity', event.params.noticeId, event.data?.get('type'));
});

export const stationMembershipPush = onDocumentCreated({
  document: 'stationJoinRequests/{uid}', region: 'asia-southeast1', retry: true,
}, async event => {
  if (Date.now() - Date.parse(event.time) > 5 * 60_000) return;
  const request = event.data?.data();
  if (request?.status !== 'pending') return;
  await deliver(request.stationId, 'members', event.params.uid, 'membership-request');
});
