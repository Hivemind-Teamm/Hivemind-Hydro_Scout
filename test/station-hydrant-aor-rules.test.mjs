import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { GeoPoint, serverTimestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-station-hydrant-aor', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('stations/one').set({ name: 'One', active: true, aorBarangays: ['Barangay One'] });
    await db.doc('stations/two').set({ name: 'Two', active: true, aorBarangays: ['Barangay Two'] });
    await db.doc('stations/empty').set({ name: 'Empty', active: true });
    await db.doc('stations/off').set({ name: 'Inactive', active: false, aorBarangays: ['Barangay One'] });
    for (const [uid, role, stationId, status] of [
      ['authorized','authorized','one','approved'], ['head','head','one','approved'],
      ['other','head','two','approved'], ['pending','authorized','one','pending'],
      ['general','general','one','approved'], ['none','head',null,'approved'],
      ['empty','head','empty','approved'], ['off','head','off','approved'], ['admin','admin',null,'none'],
    ]) await db.doc(`users/${uid}`).set({ role, stationId, displayName: uid, accountType: 'person', stationMembershipStatus: status, aorBarangays: ['Barangay Two'] });
    await db.doc('stationAccountIndex/station').set({ stationId: 'one' });
    await db.doc('stations/one/accounts/station').set({ uid: 'station', displayName: 'station', accountType: 'station', stationId: 'one', aorBarangays: ['Barangay Two'] });
    await db.doc('hydrants/HYD-001').set({ barangay: 'Barangay One', location: new GeoPoint(14.65, 121.06), operationalStatus: 'Operational' });
    await db.doc('hydrants/inside').set({ barangay: 'Barangay One', operationalStatus: 'Operational', pressureStatus: 'Strong' });
    await db.doc('hydrants/outside').set({ barangay: 'Barangay Two', operationalStatus: 'Operational' });
    await db.doc('hydrants/unknown').set({ operationalStatus: 'Operational' });
  });
  const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  for (const uid of ['authorized','head','station']) {
    const db = dbFor(uid);
    const update = db.batch();
    update.update(db.doc('hydrants/HYD-001'), { operationalStatus: 'Reduced Pressure', pressureStatus: 'Moderate', updatedAt: serverTimestamp(), register: [{ by: uid, action: 'Status updated' }] });
    update.set(db.doc(`stations/one/notifications/edit-${uid}`), {
      type: 'hydrant-updated', uid, displayName: uid, hydrantId: 'HYD-001', lat: 14.65, lng: 121.06,
      message: `${uid} updated hydrant HYD-001.`, createdAt: serverTimestamp(),
    });
    await assertSucceeds(update.commit());
    await assertSucceeds(db.doc('hydrants/inside').update({ validated: true, validatedAt: serverTimestamp(), validatedBy: uid }));
    await assertFails(db.doc('hydrants/outside').update({ flaggedForReinspection: true, flaggedAt: serverTimestamp(), flaggedBy: uid }));
    await assertSucceeds(dbFor(uid).doc('hydrants/inside').update({ operationalStatus: 'Out of Service', pressureStatus: 'None', fieldNotes: [{ text: 'Test' }], updatedAt: serverTimestamp() }));
    await assertFails(dbFor(uid).doc('hydrants/outside').update({ operationalStatus: 'Out of Service' }));
    await assertFails(dbFor(uid).doc('hydrants/unknown').update({ operationalStatus: 'Out of Service' }));
    await assertFails(dbFor(uid).doc('hydrants/inside').update({ barangay: 'Barangay Two', operationalStatus: 'Operational' }));
    await assertFails(dbFor(uid).doc('hydrants/inside').update({ location: { lat: 10, lng: 20 } }));
    await assertFails(dbFor(uid).doc('stations/one').update({ aorBarangays: ['Barangay One','Barangay Two'] }));
    await assertFails(dbFor(uid).doc('hydrants/inside').delete());
  }
  for (const uid of ['other','pending','general','none','empty','off',null]) {
    await assertFails(dbFor(uid).doc('hydrants/inside').update({ operationalStatus: 'Operational' }));
    await assertSucceeds(dbFor(uid).doc('hydrants/inside').get());
  }
  await assertSucceeds(dbFor('admin').doc('hydrants/outside').update({ notes: 'Admin override' }));
  await assertSucceeds(dbFor('admin').doc('stations/one').update({ aorBarangays: ['Barangay Two'] }));
  await assertFails(dbFor('head').doc('hydrants/inside').update({ notes: 'Stale AoR' }));
  await assertSucceeds(dbFor('head').doc('hydrants/outside').update({ notes: 'Updated station AoR' }));
  await assertFails(dbFor('admin').doc('stations/one').update({ aorBarangays: 'not a list' }));
  await assertFails(dbFor('admin').doc('stations/one').update({ aorBarangays: Array(101).fill('Barangay') }));
  assert.equal((await dbFor('head').doc('hydrants/outside').get()).data().notes, 'Updated station AoR');
  console.log('Station AoR rules: canonical station boundaries, roles, pending members, stale account AoR, admin configuration, and coordinate/assignment bypass checks passed.');
} finally { await env.cleanup(); }
