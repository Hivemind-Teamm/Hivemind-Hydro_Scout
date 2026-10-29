import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { GeoPoint, serverTimestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-map-activity', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, role, stationId] of [['head', 'head', 'one'], ['member', 'general', 'one'], ['outsider', 'head', 'two']]) {
      await context.firestore().doc(`users/${uid}`).set({ accountType: 'person', displayName: uid, role, stationId, stationMembershipStatus: 'approved' });
    }
    // Hydrant edits and reports are limited to the station AOR.
    await context.firestore().doc('stations/one').set({ name: 'One', active: true, aorBarangays: ['Central'] });
    await context.firestore().doc('users/delegate').set({ accountType: 'person', displayName: 'Delegate', role: 'authorized', stationId: 'one', stationMembershipStatus: 'approved', stationAccessIds: ['one'] });
  });
  const db = env.authenticatedContext('head').firestore();
  const notice = (patch = {}) => ({ type: 'fire-pinned', uid: 'head', displayName: 'head', message: 'head pinned a fire incident.', lat: 14.65, lng: 121.06, createdAt: serverTimestamp(), ...patch });
  const ref = db.doc('stations/one/notifications/fire');
  await assertSucceeds(ref.set(notice()));
  await assertSucceeds(ref.get());
  await assertFails(ref.update({ message: 'Changed' }));
  await assertFails(ref.delete());
  for (const uid of ['member', 'delegate', 'outsider']) {
    const limited = env.authenticatedContext(uid).firestore();
    await assertFails(limited.doc('stations/one/notifications/fire').get());
    await assertFails(limited.collection('stations/one/notifications').get());
  }
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
  // Hydrant creation is server-only (POST /api/hydrants writes the hydrant and
  // its pin notice together), so a client-side create batch is rejected.
  const batch = db.batch();
  batch.set(db.doc('hydrants/HYD-001'), { location: new GeoPoint(14.65, 121.06), createdAt: serverTimestamp() });
  batch.set(db.doc('stations/one/notifications/hydrant'), pin);
  await assertFails(batch.commit());
  await env.withSecurityRulesDisabled(context => context.firestore().doc('hydrants/HYD-001').set({
    location: new GeoPoint(14.65, 121.06), barangay: 'Central', createdAt: new Date(),
  }));
  const update = notice({ type: 'hydrant-updated', hydrantId: 'HYD-001', message: 'head updated hydrant HYD-001.' });
  await assertFails(db.collection('stations/one/notifications').add(update));
  const edit = db.batch();
  edit.update(db.doc('hydrants/HYD-001'), { updatedAt: serverTimestamp(), waterCleanliness: 'Clear' });
  edit.set(db.doc('stations/one/notifications/update'), update);
  await assertSucceeds(edit.commit());
  // Ownership metadata cannot be forged at creation or reassigned by an edit.
  await assertFails(db.doc('hydrants/HYD-001/reports/forged').set({ reporterUid: 'member', status: 'pending' }));
  await assertSucceeds(db.doc('hydrants/HYD-001/reports/own').set({ reporterUid: 'head', status: 'pending' }));
  await assertFails(db.doc('hydrants/HYD-001/reports/own').update({ reporterUid: 'member' }));
  await assertSucceeds(db.doc('hydrants/HYD-001/reports/own').update({ status: 'resolved' }));
  // Existing hydrants cannot be replayed as fresh pin events.
  await assertFails(db.collection('stations/one/notifications').add(pin));
  const mismatch = db.batch();
  mismatch.set(db.doc('hydrants/HYD-002'), { location: new GeoPoint(14.66, 121.06), createdAt: serverTimestamp() });
  mismatch.set(db.doc('stations/one/notifications/mismatch'), { ...pin, hydrantId: 'HYD-002', message: 'head pinned hydrant HYD-002.' });
  await assertFails(mismatch.commit());
  assert.equal((await db.doc('hydrants/HYD-002').get()).exists, false);
  console.log('Map activity authorization and atomicity checks passed.');
} finally { await env.cleanup(); }
