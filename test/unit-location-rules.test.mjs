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
    general: { role: 'general', stationId: 'station-1' },
    firefighter: { role: 'authorized', stationId: 'station-1' },
    admin: { role: 'admin' },
    invalidRole: { role: 'invalid' },
  };
  await env.withSecurityRulesDisabled(async ctx => {
    for (const [uid, data] of Object.entries(profiles)) await ctx.firestore().doc(`users/${uid}`).set(data);
  });
  const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const ref = uid => db(uid).doc('unitLocations/station-1');
  const payload = uid => ({ stationId: 'station-1', updatedBy: uid, lat: 14.65, lng: 121.06, accuracy: 8, updatedAt: serverTimestamp() });
  assert.equal(await writeLoginLocation('station', {
    readProfile: async () => (await db('station').doc('users/station').get()).data(),
    isCurrentSession: () => true,
    geolocation: { getCurrentPosition: success => success({ coords: { latitude: 14.65, longitude: 121.06, accuracy: 8 } }) },
    writePosition: position => db('station').doc(`unitLocations/${position.stationId}`).set({ ...position, updatedAt: serverTimestamp() }),
  }), 'written');
  const stored = (await ref('station').get()).data();
  assert.equal(stored.stationId, 'station-1');
  assert.equal(stored.lat, 14.65);
  assert.equal(stored.updatedBy, 'station');
  assert.ok(stored.updatedAt.toMillis() > 0);
  await assertSucceeds(ref('head').set(payload('head')));
  await assertSucceeds(ref('station').set(payload('station')));
  for (const uid of [null, 'general', 'firefighter', 'other', 'missing', 'admin', 'unknown', 'invalidRole']) {
    await assertFails(ref(uid).set(payload(uid ?? 'anonymous')));
  }
  for (const uid of Object.keys(profiles).filter(uid => uid !== 'invalidRole')) {
    await assertSucceeds(ref(uid).get());
    await assertSucceeds(db(uid).collection('unitLocations').get());
  }
  for (const uid of [null, 'unknown', 'invalidRole']) {
    await assertFails(ref(uid).get());
    await assertFails(db(uid).collection('unitLocations').get());
  }
  for (const uid of [null, 'general', 'firefighter', 'other', 'missing', 'head', 'unknown', 'invalidRole']) {
    await assertFails(ref(uid).delete());
  }
  await assertSucceeds(ref('station').get());
  await assertFails(ref('station').delete());
  await assertFails(db('station').doc('unitLocations/station-1/history/entry').set(payload('station')));
  await assertSucceeds(db('admin').collection('unitLocations').get());
  await assertSucceeds(db('station').collection('unitLocations').where('__name__', '==', 'station-1').get());
  for (const patch of [
    { stationId: 'station-2' }, { updatedBy: 'other' }, { lat: 91 }, { lng: -181 },
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
  await env.withSecurityRulesDisabled(ctx => ctx.firestore().doc('unitLocations/station-1').delete());
  await assertFails(ref('station').set({ ...payload('station'), lat: 91 }));
  await assertSucceeds(ref('station').set(payload('station')));
  const newcomer = db('new-user').doc('users/new-user');
  await assertFails(newcomer.set({ role: 'admin' }));
  await assertFails(newcomer.set({ role: 'authorized', stationId: 'station-1' }));
  await assertFails(newcomer.set({ role: 'general', stationId: 'station-1' }));
  await assertFails(newcomer.set({ role: 'general', accountType: 'station', stationId: 'station-1' }));
  await assertSucceeds(newcomer.set({ role: 'general', email: 'new@example.com', displayName: 'New', createdAt: serverTimestamp(), lastLoginAt: serverTimestamp() }));
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
