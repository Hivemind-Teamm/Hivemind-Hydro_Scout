// End-to-end: POST /api/hydrants derives the barangay from GPS and enforces the
// creator's station AOR. Needs the Auth + Firestore emulators and a dev server:
//   GCLOUD_PROJECT=demo-hydro-scout-api FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx next dev -p 3002
//   TEST_BASE_URL=http://127.0.0.1:3002 (same emulator env) node --test test/hydrant-create-api.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'demo-hydro-scout-api';
const BASE_URL = process.env.TEST_BASE_URL;
if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
  !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE_URL ?? '')
) {
  throw new Error('Exact local emulator configuration and a local TEST_BASE_URL are required.');
}

const app = initializeApp({ projectId: PROJECT }, `hydrant-api-${randomUUID()}`);
const auth = getAuth(app);
const db = getFirestore(app);
const run = randomUUID().slice(0, 8);
const KNL = `KNL-${run}`;
const UP_CAMPUS = { lat: 14.65595, lng: 121.06322 };    // surveyed HYD-005
const LAGING_HANDA = { lat: 14.63371, lng: 121.03454 }; // surveyed HYD-032
const MAKATI = { lat: 14.5547, lng: 121.0244 };
const sessions = {};
const createdUids = [];

async function account(name, profile) {
  const uid = `${name}-${run}`;
  const email = `${uid}@example.test`;
  const password = `Demo-${randomUUID()}!`;
  await auth.createUser({ uid, email, password });
  createdUids.push(uid);
  if (profile.accountType === 'station') {
    await db.doc(`stationAccountIndex/${uid}`).set({ stationId: KNL });
    await db.doc(`stations/${KNL}/accounts/${uid}`).set({
      uid, email, displayName: 'Krus na Ligas Fire Station', accountType: 'station', station: 'Krus na Ligas Fire Station',
      stationId: KNL, aorBarangays: [], createdAt: new Date(), lastLoginAt: null,
    });
  } else {
    await db.doc(`users/${uid}`).set({ uid, email, displayName: name, accountType: 'person', ...profile });
  }
  const signIn = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const { idToken } = await signIn.json();
  const session = await fetch(`${BASE_URL}/api/auth/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  const cookie = /(?:^|,\s*)session=([^;,\s]+)/.exec(session.headers.get('set-cookie') ?? '')?.[1];
  assert.ok(cookie, `${name} did not receive a session cookie (${session.status})`);
  sessions[name] = `session=${cookie}`;
}

const pin = (who, at, extra = {}) => fetch(`${BASE_URL}/api/hydrants`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE_URL, ...(who ? { Cookie: sessions[who] } : {}) },
  body: JSON.stringify({ ...at, address: 'Test address', status: 'operational', outlets: 2, ...extra }),
});
const created = [];
async function expectCreated(response, barangay) {
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  created.push(body.id);
  assert.equal(body.barangay, barangay);
  const hydrant = (await db.doc(`hydrants/${body.id}`).get()).data();
  assert.equal(hydrant.barangay, barangay);
  return { id: body.id, hydrant };
}

before(async () => {
  await db.doc(`stations/${KNL}`).set({
    name: 'Krus na Ligas Fire Station', active: true, createdAt: new Date(),
    aorBarangays: ['Krus na Ligas', 'U.P. Campus', 'U.P. Village', 'Botocan', 'San Vicente', "Teachers' Village East"],
  });
  await account('knl-station', { accountType: 'station' });
  await account('knl-member', { role: 'authorized', stationId: KNL, stationMembershipStatus: 'approved' });
  await account('knl-pending', { role: 'head', stationId: KNL, stationMembershipStatus: 'pending' });
  await account('general', { role: 'general', stationId: null, stationMembershipStatus: 'none' });
  await account('admin', { role: 'admin', stationId: null, stationMembershipStatus: 'none' });
});

after(async () => {
  for (const id of created) await db.doc(`hydrants/${id}`).delete();
  for (const uid of createdUids) {
    await db.doc(`users/${uid}`).delete();
    await db.doc(`stationAccountIndex/${uid}`).delete();
    await db.doc(`stations/${KNL}/accounts/${uid}`).delete();
    await auth.deleteUser(uid);
  }
  const notices = await db.collection(`stations/${KNL}/notifications`).get();
  await Promise.all(notices.docs.map(notice => notice.ref.delete()));
  await db.doc(`stations/${KNL}`).delete();
  await deleteApp(app);
});

test('rejects anonymous and cross-origin requests', async () => {
  assert.equal((await pin(null, UP_CAMPUS)).status, 401);
  const crossOrigin = await fetch(`${BASE_URL}/api/hydrants`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: sessions.admin },
    body: JSON.stringify({ ...UP_CAMPUS, address: 'x', status: 'operational' }),
  });
  assert.equal(crossOrigin.status, 403);
});

test('a station pins inside its AOR with a GPS-derived barangay and a station notification', async () => {
  // A client-supplied barangay is ignored.
  const { id, hydrant } = await expectCreated(await pin('knl-station', UP_CAMPUS, { barangay: 'Laging Handa' }), 'U.P. Campus');
  assert.match(id, /^HYD-\d{3}$/);
  assert.equal(hydrant.inspector, 'Krus na Ligas Fire Station');
  const notices = await db.collection(`stations/${KNL}/notifications`).where('hydrantId', '==', id).get();
  assert.equal(notices.size, 1);
  assert.equal(notices.docs[0].data().type, 'hydrant-pinned');
});

test('a station cannot pin in another station AOR or outside Quezon City', async () => {
  const before = (await db.collection('hydrants').get()).size;
  const outside = await pin('knl-station', LAGING_HANDA);
  assert.equal(outside.status, 403);
  assert.match((await outside.json()).error, /Laging Handa is outside Krus na Ligas Fire Station/);
  assert.equal((await pin('knl-station', MAKATI)).status, 403);
  assert.equal((await db.collection('hydrants').get()).size, before);
});

test('approved members follow the station AOR; pending and general accounts cannot pin', async () => {
  await expectCreated(await pin('knl-member', UP_CAMPUS), 'U.P. Campus');
  assert.equal((await pin('knl-member', LAGING_HANDA)).status, 403);
  assert.equal((await pin('knl-pending', UP_CAMPUS)).status, 403);
  assert.equal((await pin('general', UP_CAMPUS)).status, 403);
});

test('admins can pin anywhere, still with a derived barangay', async () => {
  await expectCreated(await pin('admin', LAGING_HANDA), 'Laging Handa');
  const outsideQc = await expectCreated(await pin('admin', MAKATI), null);
  assert.equal(outsideQc.hydrant.barangay, null);
});

test('rejects invalid input', async () => {
  assert.equal((await pin('admin', { lat: 999, lng: 121 })).status, 400);
  assert.equal((await pin('admin', UP_CAMPUS, { status: 'exploded' })).status, 400);
  assert.equal((await pin('admin', UP_CAMPUS, { address: '' })).status, 400);
  assert.equal((await pin('admin', UP_CAMPUS, { photos: ['javascript:alert(1)'] })).status, 400);
});
