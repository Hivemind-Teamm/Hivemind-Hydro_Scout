import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { GeoPoint, serverTimestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-map-activity', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, role, stationId] of [['head', 'head', 'one'], ['member', 'general', 'one'], ['outsider', 'head', 'two']]) {
      await context.firestore().doc(`users/${uid}`).set({ accountType: 'person', displayName: uid, role, stationId });
    }
  });
  const db = env.authenticatedContext('head').firestore();
  const notice = (patch = {}) => ({ type: 'fire-pinned', uid: 'head', displayName: 'head', message: 'head pinned a fire incident.', lat: 14.65, lng: 121.06, createdAt: serverTimestamp(), ...patch });
  const ref = db.doc('stations/one/notifications/fire');
  await assertSucceeds(ref.set(notice()));
  await assertSucceeds(ref.get());
  await assertFails(ref.update({ message: 'Changed' }));
  await assertFails(ref.delete());
  for (const patch of [{ uid: 'outsider' }, { displayName: 'outsider' }, { lat: 91 }, { lng: -181 }, { lat: '14' }, { type: 'other' }, { extra: true }, { message: 'Spoofed' }, { hydrantId: 'HYD-001' }]) {
    await assertFails(db.collection('stations/one/notifications').add(notice(patch)));
  }
  await assertFails(db.collection('stations/two/notifications').add(notice()));
  for (const uid of ['member', 'outsider', null]) {
    const other = uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
    await assertFails(other.collection('stations/one/notifications').add(notice()));
  }
  const pin = notice({ type: 'hydrant-pinned', hydrantId: 'HYD-001', message: 'head pinned hydrant HYD-001.' });
  await assertFails(db.collection('stations/one/notifications').add(pin));
  const batch = db.batch();
  batch.set(db.doc('hydrants/HYD-001'), { location: new GeoPoint(14.65, 121.06), createdAt: serverTimestamp() });
  batch.set(db.doc('stations/one/notifications/hydrant'), pin);
  await assertSucceeds(batch.commit());
  // Existing hydrants cannot be replayed as fresh pin events.
  await assertFails(db.collection('stations/one/notifications').add(pin));
  const mismatch = db.batch();
  mismatch.set(db.doc('hydrants/HYD-002'), { location: new GeoPoint(14.66, 121.06), createdAt: serverTimestamp() });
  mismatch.set(db.doc('stations/one/notifications/mismatch'), { ...pin, hydrantId: 'HYD-002', message: 'head pinned hydrant HYD-002.' });
  await assertFails(mismatch.commit());
  assert.equal((await db.doc('hydrants/HYD-002').get()).exists, false);
  console.log('Map activity authorization and atomicity checks passed.');
} finally { await env.cleanup(); }
