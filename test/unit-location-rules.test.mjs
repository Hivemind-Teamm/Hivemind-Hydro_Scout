import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp, Timestamp, deleteField } from 'firebase/firestore';
import assert from 'node:assert/strict';
import { writeLoginLocation } from '../lib/unit-location.ts';

const env = await initializeTestEnvironment({
  projectId: 'demo-unit-locations',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});
try {
  const profiles = {
    station: { role: 'authorized', accountType: 'station', stationId: 'station-1' },
    head: { role: 'head', accountType: 'station', stationId: 'station-1' },
    other: { role: 'authorized', accountType: 'station', stationId: 'station-2' },
    missing: { role: 'authorized', accountType: 'station' },
    invalidStation: { role: 'authorized', accountType: 'station', stationId: 'station/1' },
    general: { role: 'general', stationId: 'station-1' },
    firefighter: { role: 'authorized', stationId: 'station-1' },
    admin: { role: 'admin' },
    invalidRole: { role: 'invalid' },
  };
  await env.withSecurityRulesDisabled(async ctx => {
    for (const [uid, data] of Object.entries(profiles)) await ctx.firestore().doc(`users/${uid}`).set(data);
  });
  const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const deviceId = '11111111-1111-4111-8111-111111111111';
  const reportId = `station_${deviceId}`;
  const ref = (uid, stationId = 'station-1') => db(uid).doc(`stations/${stationId}/unitLocations/${reportId}`);
  const payload = uid => ({ deviceId, stationId: 'station-1', updatedBy: uid, lat: 14.65, lng: 121.06, accuracy: 8, updatedAt: serverTimestamp() });
  assert.equal(await writeLoginLocation('station', {
    readProfile: async () => (await db('station').doc('users/station').get()).data(),
    isCurrentSession: () => true,
    geolocation: { getCurrentPosition: success => success({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } }) },
    writePosition: position => db('station').doc(`stations/station-1/unitLocations/${reportId}`).set({ ...position, deviceId, updatedAt: serverTimestamp() }),
  }), 'written');
  const stored = (await ref('station').get()).data();
  assert.equal(stored.stationId, 'station-1');
  assert.equal(stored.lat, 14.65);
  assert.equal(stored.updatedBy, 'station');
  assert.ok(stored.updatedAt.toMillis() > 0);
  await assertFails(ref('head').set(payload('head')));
  await assertSucceeds(db('head').doc(`stations/station-1/unitLocations/head_${deviceId}`).set(payload('head')));
  const secondDevice = '22222222-2222-4222-8222-222222222222';
  await assertSucceeds(db('station').doc(`stations/station-1/unitLocations/station_${secondDevice}`).set({ ...payload('station'), deviceId: secondDevice }));
  const otherDevice = '33333333-3333-4333-8333-333333333333';
  const otherReportId = `other_${otherDevice}`;
  await assertSucceeds(db('other').doc(`stations/station-2/unitLocations/${otherReportId}`).set({
    ...payload('other'), deviceId: otherDevice, stationId: 'station-2',
  }));
  assert.equal((await db('station').collection('stations/station-1/unitLocations').get()).size, 3);
  await assertSucceeds(ref('station').set(payload('station')));
  for (const uid of [null, 'general', 'firefighter', 'invalidStation', 'missing', 'admin', 'unknown', 'invalidRole']) {
    await assertFails(ref(uid).set(payload(uid ?? 'anonymous')));
  }
  for (const uid of ['station', 'head', 'admin']) {
    await assertSucceeds(ref(uid).get());
    await assertSucceeds(db(uid).collection('stations/station-1/unitLocations').get());
  }
  await assertSucceeds(ref('other', 'station-2').get());
  await assertSucceeds(db('other').collection('stations/station-2/unitLocations').get());
  for (const uid of [null, 'general', 'firefighter', 'invalidStation', 'missing', 'other', 'unknown', 'invalidRole']) {
    await assertFails(ref(uid).get());
    await assertFails(db(uid).collection('stations/station-1/unitLocations').get());
  }
  for (const uid of [null, 'general', 'firefighter', 'invalidStation', 'other', 'missing', 'head', 'unknown', 'invalidRole']) {
    await assertFails(ref(uid).delete());
  }
  await assertFails(ref('station').delete());
  await assertFails(db('station').doc('stations/station-1/unitLocations/station-1/history/entry').set(payload('station')));
  await assertSucceeds(db('admin').collectionGroup('unitLocations').get());
  await assertSucceeds(db('station').collection('stations/station-1/unitLocations').where('__name__', '==', reportId).get());
  for (const patch of [
    { deviceId: 'invalid' }, { deviceId: 'a'.repeat(1000) }, { stationId: 'station-2' }, { updatedBy: 'other' }, { lat: 91 }, { lng: -181 },
    { lat: '14' }, { accuracy: -1 }, { accuracy: Infinity },
    { updatedAt: Timestamp.fromMillis(0) }, { extra: true },
    { stationId: 'a'.repeat(129) }, { updatedBy: 'a'.repeat(129) },
  ]) {
    await assertFails(ref('station').set({ ...payload('station'), ...patch }));
    await assertFails(ref('station').update({ ...patch, ...(patch.updatedAt ? {} : { updatedAt: serverTimestamp() }) }));
  }
  for (const field of Object.keys(payload('station'))) {
    const data = payload('station');
    delete data[field];
    await assertFails(ref('station').set(data));
    await assertFails(ref('station').update({ [field]: deleteField() }));
  }
  // Exercise validation on create as well as update.
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc(`stations/station-1/unitLocations/${reportId}`).delete());
  await assertFails(ref('station').set({ ...payload('station'), lat: 91 }));
  await assertSucceeds(ref('station').set(payload('station')));
  const newcomer = db('new-user').doc('users/new-user');
  await assertFails(newcomer.set({ role: 'admin' }));
  await assertFails(newcomer.set({ role: 'authorized', stationId: 'station-1' }));
  await assertFails(newcomer.set({ role: 'general', stationId: 'station-1' }));
  await assertFails(newcomer.set({ role: 'general', accountType: 'station', stationId: 'station-1' }));
  await assertSucceeds(newcomer.set({
    role: 'general',
    accountType: 'person',
    stationMembershipStatus: 'none',
    email: 'new@example.com',
    displayName: 'New',
    createdAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
  }));
  await assertFails(newcomer.update({ role: 'authorized', stationId: 'station-1' }));
  await assertSucceeds(newcomer.update({ lastLoginAt: serverTimestamp() }));
  await assertSucceeds(db('admin').doc('users/new-user').update({ role: 'authorized', stationId: 'station-1' }));
  await assertSucceeds(db('admin').doc('users/station').update({ stationId: 'station-2' }));
  await assertFails(ref('station').set(payload('station')));
  await assertSucceeds(ref('admin').delete());
  console.log('Unit location rules: all checks passed');
} finally {
  await env.cleanup();
}
