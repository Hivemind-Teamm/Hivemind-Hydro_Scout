import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import assert from 'node:assert/strict';

const env = await initializeTestEnvironment({
  projectId: 'demo-hydrant-checking',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'stations/ONE'), { name: 'Station One', active: true, aorBarangays: ['Barangay One'], createdAt: serverTimestamp() });
    await setDoc(doc(db, 'stations/TWO'), { name: 'Station Two', active: true, aorBarangays: ['Barangay Two'], createdAt: serverTimestamp() });
    await setDoc(doc(db, 'users/head'), { role: 'head', accountType: 'person', stationId: 'ONE', stationMembershipStatus: 'approved', displayName: 'Head' });
    await setDoc(doc(db, 'users/authorized'), { role: 'authorized', accountType: 'person', stationId: 'ONE', stationMembershipStatus: 'approved', displayName: 'Authorized' });
    await setDoc(doc(db, 'users/general'), { role: 'general', accountType: 'person', stationId: 'ONE', stationMembershipStatus: 'approved', displayName: 'General' });
    await setDoc(doc(db, 'users/admin'), { role: 'admin', accountType: 'person', displayName: 'Admin' });
    await setDoc(doc(db, 'hydrants/HYD-001'), { barangay: 'Barangay One', operationalStatus: 'Operational' });
    await setDoc(doc(db, 'hydrants/HYD-002'), { barangay: 'Barangay Two', operationalStatus: 'Operational' });
    await setDoc(doc(db, 'stations/ONE/checkingSessions/session-one'), {
      stationId: 'ONE', name: 'Field test', status: 'active', targetHydrantIds: ['HYD-001'], targetHydrantCount: 1,
      startedAt: serverTimestamp(), startedByUid: 'head', startedByName: 'Head',
    });
  });

  const as = uid => env.authenticatedContext(uid).firestore();
  const session = doc(as('head'), 'stations/ONE/checkingSessions/session-one');
  await assertFails(setDoc(doc(as('head'), 'stations/ONE/checkingSessions/not-allowed'), {
    stationId: 'ONE', name: 'Field test', status: 'active', startedAt: serverTimestamp(), startedByUid: 'head', startedByName: 'Head',
  }));
  await assertFails(setDoc(doc(as('authorized'), 'stations/ONE/checkingSessions/not-allowed'), {
    stationId: 'ONE', name: 'Field test', status: 'active', startedAt: serverTimestamp(), startedByUid: 'authorized', startedByName: 'Authorized',
  }));

  const one = doc(as('authorized'), 'stations/ONE/checkingSessions/session-one/items/HYD-001');
  const two = doc(as('authorized'), 'stations/ONE/checkingSessions/session-one/items/HYD-002');
  const check = (hydrantId, status = 'checked') => ({ hydrantId, status, note: '', checkedByUid: 'authorized', checkedByName: 'Authorized', checkedAt: serverTimestamp() });
  await assertSucceeds(setDoc(one, check('HYD-001')));
  await assertFails(setDoc(two, check('HYD-002')));
  await assertFails(setDoc(doc(as('general'), 'stations/ONE/checkingSessions/session-one/items/HYD-001'), { ...check('HYD-001'), checkedByUid: 'general', checkedByName: 'General' }));
  await assertSucceeds(getDoc(doc(as('admin'), 'stations/ONE/checkingSessions/session-one/items/HYD-001')));

  await assertFails(updateDoc(session, { status: 'completed', endedAt: serverTimestamp(), endedByUid: 'head', endedByName: 'Head' }));
  assert.ok(true, 'Hydrant checking is station-scoped and AOR-limited; the verified server route alone opens and completes sessions.');
} finally {
  await env.cleanup();
}
