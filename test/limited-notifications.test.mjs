import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'exports', code)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), `${id}.ts`)) : require(id), exports);
  return exports;
}
const { limitedNotificationFeed, notificationProfile, serializeLimitedNotification } = load(path.resolve('lib/limited-notification-service.ts'));

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Local Firestore emulator required.');
const app = initializeApp({ projectId: 'demo-limited-notifications' }, 'limited-notifications-test');
const db = getFirestore(app);
const stamp = Timestamp.fromMillis(1000);
try {
  const batch = db.batch();
  for (const [id, data] of Object.entries({
    'users/member': { accountType: 'person', role: 'authorized', stationId: 'one', stationMembershipStatus: 'approved' },
    'users/general': { accountType: 'person', role: 'general' },
    'users/delegate': { accountType: 'person', role: 'authorized', stationId: 'one', stationMembershipStatus: 'pending', stationAccessIds: ['one'] },
    'stations/one/joinRequests/general': { uid: 'general', stationId: 'one', status: 'rejected', createdAt: stamp, reviewedAt: stamp },
    'stations/one/joinRequests/other': { uid: 'other', stationId: 'one', status: 'pending', createdAt: stamp },
    'stations/one/notifications/fire': { type: 'fire-pinned', message: 'SECRET person pinned fire', uid: 'SECRET', displayName: 'SECRET', createdAt: stamp, lat: 14.65, lng: 121.06 },
    'stations/one/notifications/account': { type: 'personal-station-assigned', message: 'SECRET admin email', createdAt: stamp },
    'stations/two/notifications/other': { type: 'fire-pinned', message: 'Other station', createdAt: stamp },
    'stations/one/responses/response': { stationId: 'one', status: 'active', uid: 'SECRET', displayName: 'SECRET', lastLocationAt: stamp, startedAt: stamp },
    'stations/one/notifications/response_start': { type: 'response-started', responseId: 'response', uid: 'SECRET', displayName: 'SECRET', message: 'SECRET responding', createdAt: stamp },
    'hydrants/HYD-001/reports/own': { reporterUid: 'general', status: 'pending', description: 'PRIVATE', createdAt: stamp },
    'hydrants/HYD-001/reports/other': { reporterUid: 'other', status: 'resolved', createdAt: stamp },
    'hydrants/HYD-001/reports/legacy': { reporter: 'general', status: 'resolved', createdAt: stamp },
  })) batch.set(db.doc(id), data);
  await batch.commit();
  const feed = async uid => limitedNotificationFeed(db, uid, await notificationProfile(db, uid));
  const member = await feed('member');
  assert.deepEqual(member.map(item => item.type).sort(), ['fire-pinned', 'response-started']);
  assert.equal(JSON.stringify(member.map(serializeLimitedNotification)).includes('SECRET'), false);
  assert.notEqual(member.find(item => item.response).responseId, 'response');
  const general = await feed('general');
  assert.deepEqual(general.map(item => item.type).sort(), ['membership-rejected', 'report-pending']);
  assert.equal(JSON.stringify(general).includes('PRIVATE'), false);
  assert.deepEqual(await feed('delegate'), []);
  await db.doc('users/member').update({ stationMembershipStatus: 'rejected' });
  assert.deepEqual(await feed('member'), []);
  await db.doc('users/member').update({ stationMembershipStatus: 'approved' });
  await db.doc('stations/one/responses/response').update({ status: 'ended', endedAt: Timestamp.fromMillis(2000), endedByName: 'SECRET' });
  await db.doc('stations/one/notifications/response_end').set({ type: 'response-ended', responseId: 'response', message: 'SECRET ended', createdAt: Timestamp.fromMillis(2000) });
  const ended = (await feed('member')).filter(item => item.response);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].response.status, 'ended');
  assert.equal(JSON.stringify(ended).includes('SECRET'), false);
  assert.notEqual(member.find(item => item.response).id, ended[0].id);
  await db.doc('hydrants/HYD-001/reports/own').update({ status: 'resolved', resolvedAt: Timestamp.fromMillis(3000) });
  const resolved = (await feed('general')).find(item => item.type === 'report-resolved');
  assert.ok(resolved);
  assert.notEqual(resolved.id, general.find(item => item.type === 'report-pending').id);
  console.log('Limited notification projection, station/ownership isolation, revocation, and event-version checks passed.');
} finally { await deleteApp(app); }
