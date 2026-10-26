import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-shared-fire-pins', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const id = 'abcdefghijklmnopqrst';
try {
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, role, stationId] of [['creator', 'authorized', 'one'], ['member', 'authorized', 'one'], ['general', 'general', 'two'], ['head', 'head', 'one'], ['outsider', 'head', 'two'], ['admin', 'admin', null]]) {
      await context.firestore().doc(`users/${uid}`).set({ accountType: 'person', role, stationId, displayName: uid });
    }
  });
  const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const create = (db, uid, pinId = id, patch = {}, notice = false) => {
    const batch = db.batch();
    batch.set(db.doc(`fireIncidents/${pinId}`), { lat: 14.65, lng: 121.06, stationId: 'one', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch });
    batch.set(db.doc(`fireIncidents/${pinId}/ownership/record`), { uid, stationId: 'one', createdAt: serverTimestamp() });
    if (notice) batch.set(db.doc(`stations/one/notifications/fire-${pinId}`), {
      type: 'fire-pinned', uid, displayName: uid, lat: 14.65, lng: 121.06, firePinId: pinId,
      message: `${uid} pinned a fire incident.`, createdAt: serverTimestamp(),
    });
    return batch.commit();
  };
  const creator = dbFor('creator');
  const waitForPins = predicate => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('Shared map listener timed out.')); }, 5000);
    const stop = dbFor('general').collection('fireIncidents').where('status', '==', 'active').onSnapshot(snapshot => {
      if (predicate(snapshot.docs.map(record => ({ ...record.data(), id: record.id })))) {
        clearTimeout(timeout); stop(); resolve();
      }
    }, error => { clearTimeout(timeout); reject(error); });
  });
  await assertSucceeds(create(creator, 'creator'));
  for (const uid of ['general', 'member', 'head', 'outsider', 'admin']) {
    await assertSucceeds(dbFor(uid).collection('fireIncidents').where('status', '==', 'active').get());
    await assertSucceeds(dbFor(uid).doc(`fireIncidents/${id}`).get());
  }
  await assertFails(dbFor(null).doc(`fireIncidents/${id}`).get());
  await assertFails(dbFor(null).collection('fireIncidents').where('status', '==', 'active').get());
  await assertFails(dbFor('general').doc(`fireIncidents/${id}/ownership/record`).get());
  await assertFails(dbFor('outsider').doc(`fireIncidents/${id}/ownership/record`).get());
  await assertSucceeds(creator.doc(`fireIncidents/${id}/ownership/record`).get());
  await assertSucceeds(creator.collectionGroup('ownership').where('uid', '==', 'creator').get());
  await assertFails(create(dbFor('general'), 'general', 'bbbbbbbbbbbbbbbbbbbb'));
  await assertFails(create(creator, 'other', 'cccccccccccccccccccc'));
  for (const patch of [{ stationId: 'two' }, { lat: 91 }, { lng: -181 }, { extra: true }, { createdAt: Timestamp.fromMillis(0) }]) {
    await assertFails(create(creator, 'creator', 'dddddddddddddddddddd', patch));
  }
  const path = `fireIncidents/${id}`;
  for (const uid of ['general', 'member', 'outsider']) {
    await assertFails(dbFor(uid).doc(path).update({ lat: 14.66, updatedAt: serverTimestamp() }));
    await assertFails(dbFor(uid).doc(path).update({ status: 'cleared', updatedAt: serverTimestamp() }));
  }
  const movedOnOtherMap = waitForPins(pins => pins.some(pin => pin.id === id && pin.lat === 14.66));
  await assertSucceeds(creator.doc(path).update({ lat: 14.66, updatedAt: serverTimestamp() }));
  await movedOnOtherMap;
  assert.equal((await dbFor('general').doc(path).get()).data().lat, 14.66);
  await assertFails(creator.doc(path).update({ stationId: 'two', updatedAt: serverTimestamp() }));
  await assertFails(creator.doc(`fireIncidents/${id}/ownership/record`).update({ uid: 'member' }));
  await assertFails(creator.doc(path).delete());
  await assertSucceeds(create(creator, 'creator', 'eeeeeeeeeeeeeeeeeeee'));
  const clearedOnOtherMap = waitForPins(pins => !pins.some(pin => pin.id === id));
  await assertFails(dbFor('head').doc(path).update({ status: 'cleared', updatedAt: serverTimestamp() }));
  await env.withSecurityRulesDisabled(context => context.firestore().doc(path).update({ status: 'cleared', updatedAt: serverTimestamp() }));
  await clearedOnOtherMap;
  const active = await dbFor('general').collection('fireIncidents').where('status', '==', 'active').get();
  assert.deepEqual(active.docs.map(record => record.id), ['eeeeeeeeeeeeeeeeeeee']);
  await assertFails(creator.doc(path).update({ status: 'active', updatedAt: serverTimestamp() }));
  await assertFails(dbFor('admin').doc('fireIncidents/eeeeeeeeeeeeeeeeeeee').update({ status: 'cleared', updatedAt: serverTimestamp() }));
  await assertSucceeds(create(creator, 'creator', 'ffffffffffffffffffff', {}, true));
  await assertFails(create(creator, 'creator', 'gggggggggggggggggggg', { lat: 14.67 }, true));
  assert.equal((await creator.doc('fireIncidents/gggggggggggggggggggg').get()).exists, false);
  console.log('Shared fire pin signed-in visibility, public denial, private ownership, multi-pin updates and management permissions passed.');
} finally { await env.cleanup(); }
