// Station AOR enforcement with the real station layout: station accounts live
// at stations/{id}/accounts/{uid} (+ stationAccountIndex), personal accounts at
// users/{uid}, and each station's AOR at stations/{id}.aorBarangays.
// Requires the Firestore emulator (firebase emulators:exec).
import test, { after, before } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { arrayUnion, doc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp, writeBatch, GeoPoint, collection } from 'firebase/firestore';

let env;
const KNL = ['Krus na Ligas', 'U.P. Campus', 'U.P. Village', 'Botocan', 'San Vicente', "Teachers' Village East"];
const LH = ['Kamuning', 'Laging Handa', 'Obrero', 'Sacred Heart', 'South Triangle'];
const as = uid => env.authenticatedContext(uid).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-station-aor-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  // A long-running emulator keeps data between runs; creates must stay creates.
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const station = (id, name, aorBarangays, active = true) =>
      setDoc(doc(db, 'stations', id), { name, active, aorBarangays, createdAt: new Date() });
    await station('KNL', 'Krus na Ligas Fire Station', KNL);
    await station('LH', 'Laging Handa Fire Station', LH);
    await station('OLD', 'Closed Station', ['Pinyahan'], false);
    await setDoc(doc(db, 'stations', 'LEGACY'), { name: 'Seeded', active: true, stationId: 'LEGACY', placeholder: true, createdAt: new Date() });

    for (const [uid, stationId] of [['knl-station', 'KNL'], ['lh-station', 'LH']]) {
      await setDoc(doc(db, 'stationAccountIndex', uid), { stationId });
      await setDoc(doc(db, 'stations', stationId, 'accounts', uid), {
        uid, email: `${uid}@example.com`, displayName: uid, accountType: 'station', station: uid,
        stationId, aorBarangays: [], createdAt: new Date(), lastLoginAt: null,
      });
    }
    const person = (uid, role, stationId, stationMembershipStatus) =>
      setDoc(doc(db, 'users', uid), { uid, role, accountType: 'person', stationId, stationMembershipStatus, displayName: uid });
    await person('knl-head', 'head', 'KNL', 'approved');
    await person('knl-authorized', 'authorized', 'KNL', 'approved');
    await person('knl-pending', 'head', 'KNL', 'pending');
    await person('no-station-head', 'head', null, 'none');
    await person('closed-head', 'head', 'OLD', 'approved');
    await person('admin', 'admin', null, 'none');

    const hydrant = (id, barangay) => setDoc(doc(db, 'hydrants', id), {
      barangay, operationalStatus: 'Operational', pressureStatus: 'Strong', notes: '', photos: [],
    });
    await hydrant('HYD-UP', 'U.P. Campus');
    await hydrant('HYD-LH', 'Laging Handa');
    await hydrant('HYD-PIN', 'Pinyahan');
    await hydrant('HYD-NONE', null);
    // Shaped like real hydrants (HYD-### ids, GeoPoint) for the activity-notice rules.
    await setDoc(doc(db, 'hydrants', 'HYD-101'), { barangay: 'U.P. Campus', location: new GeoPoint(14.65595, 121.06322), operationalStatus: 'Operational', register: [] });
    await setDoc(doc(db, 'hydrants', 'HYD-102'), { barangay: 'Laging Handa', location: new GeoPoint(14.63371, 121.03454), operationalStatus: 'Operational', register: [] });
    await setDoc(doc(db, 'hydrants', 'HYD-101', 'reports', 'r-101'), { status: 'pending', reporterUid: 'someone' });
    await setDoc(doc(db, 'hydrants', 'HYD-102', 'reports', 'r-102'), { status: 'pending', reporterUid: 'someone' });
    await setDoc(doc(db, 'hydrants', 'HYD-UP', 'reports', 'r-up'), { status: 'pending', reporterUid: 'someone' });
    await setDoc(doc(db, 'hydrants', 'HYD-LH', 'reports', 'r-lh'), { status: 'pending', reporterUid: 'someone' });
  });
});
after(() => env?.cleanup());

const status = (uid, id, value = 'Out of Service') => updateDoc(doc(as(uid), 'hydrants', id), { operationalStatus: value });

test('station accounts edit only inside their own AOR', async () => {
  await assertSucceeds(updateDoc(doc(as('knl-station'), 'hydrants', 'HYD-UP'), { pressureStatus: 'Low', notes: 'checked' }));
  await assertFails(status('knl-station', 'HYD-LH'));
  await assertSucceeds(status('lh-station', 'HYD-LH'));
  await assertFails(status('lh-station', 'HYD-UP'));
});

test('approved members follow their station AOR; field scope still applies', async () => {
  await assertSucceeds(status('knl-head', 'HYD-UP', 'Reduced Pressure'));
  await assertFails(status('knl-head', 'HYD-LH'));
  await assertSucceeds(status('knl-authorized', 'HYD-UP', 'Operational'));
  await assertFails(status('knl-authorized', 'HYD-LH'));
  await assertFails(updateDoc(doc(as('knl-authorized'), 'hydrants', 'HYD-UP'), { notes: 'not in authorized scope' }));
});

test('no AOR access without an approved, active station', async () => {
  await assertFails(status('knl-pending', 'HYD-UP'));
  await assertFails(status('no-station-head', 'HYD-UP'));
  await assertFails(status('closed-head', 'HYD-PIN'));
  // Unassigned or out-of-AOR hydrants are admin-only.
  await assertFails(status('knl-station', 'HYD-NONE'));
  await assertFails(status('knl-station', 'HYD-PIN'));
  await assertSucceeds(status('admin', 'HYD-PIN'));
  await assertSucceeds(status('admin', 'HYD-NONE'));
});

test('non-admins can never move a hydrant between AORs or create one directly', async () => {
  await assertFails(updateDoc(doc(as('knl-station'), 'hydrants', 'HYD-LH'), { barangay: 'U.P. Campus' }));
  await assertFails(updateDoc(doc(as('knl-station'), 'hydrants', 'HYD-UP'), { barangay: 'Laging Handa' }));
  await assertFails(updateDoc(doc(as('knl-station'), 'hydrants', 'HYD-UP'), { location: { lat: 0, lng: 0 } }));
  await assertFails(setDoc(doc(as('knl-station'), 'hydrants', 'HYD-NEW'), { barangay: 'U.P. Campus' }));
  await assertFails(setDoc(doc(as('admin'), 'hydrants', 'HYD-NEW'), { barangay: 'U.P. Campus' }));
  await assertFails(deleteDoc(doc(as('knl-station'), 'hydrants', 'HYD-UP')));
  await assertSucceeds(deleteDoc(doc(as('admin'), 'hydrants', 'HYD-NONE')));
});

test('reports follow the hydrant AOR', async () => {
  await assertSucceeds(setDoc(doc(as('knl-authorized'), 'hydrants', 'HYD-UP', 'reports', 'new-up'), { status: 'pending', reporterUid: 'knl-authorized' }));
  await assertFails(setDoc(doc(as('knl-authorized'), 'hydrants', 'HYD-LH', 'reports', 'new-lh'), { status: 'pending', reporterUid: 'knl-authorized' }));
  await assertSucceeds(updateDoc(doc(as('knl-station'), 'hydrants', 'HYD-UP', 'reports', 'r-up'), { status: 'resolved' }));
  await assertFails(updateDoc(doc(as('knl-station'), 'hydrants', 'HYD-LH', 'reports', 'r-lh'), { status: 'resolved' }));
  await assertFails(deleteDoc(doc(as('knl-head'), 'hydrants', 'HYD-LH', 'reports', 'r-lh')));
  await assertSucceeds(updateDoc(doc(as('admin'), 'hydrants', 'HYD-LH', 'reports', 'r-lh'), { status: 'denied' }));
});

test('only admins change a station AOR', async () => {
  await assertFails(updateDoc(doc(as('knl-station'), 'stations', 'KNL'), { aorBarangays: [...KNL, ...LH] }));
  await assertFails(updateDoc(doc(as('knl-head'), 'stations', 'KNL'), { aorBarangays: [...KNL, 'Laging Handa'] }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'stations', 'KNL'), { aorBarangays: KNL, aorUpdatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('admin'), 'stations', 'KNL'), { aorBarangays: 'Laging Handa' }));
  await assertFails(updateDoc(doc(as('admin'), 'stations', 'KNL'), { unexpected: true }));
  // Stations seeded with extra legacy fields stay editable.
  await assertSucceeds(updateDoc(doc(as('admin'), 'stations', 'LEGACY'), { aorBarangays: ['Central'] }));
});

// The app's real multi-document writes share one rules expression budget, and
// station accounts have the most expensive profile lookup.
const statusEdit = (uid, hydrantId, lat, lng) => {
  const db = as(uid);
  return runTransaction(db, async tx => {
    const ref = doc(db, 'hydrants', hydrantId);
    await tx.get(ref);
    tx.update(ref, {
      operationalStatus: 'Reduced Pressure', pressureStatus: 'Weak', updatedBy: uid, updatedAt: serverTimestamp(),
      register: arrayUnion({ statusColor: '#f5a623', action: 'Status set to Reduced Pressure', by: uid, role: 'Head', date: '2026-10-28' }),
      waterCleanliness: 'Clear', hazards: ['Blocked'], photos: arrayUnion('https://res.cloudinary.com/x.jpg'),
      fieldNotes: arrayUnion({ user: uid, initials: 'KS', text: 'Checked', date: '2026-10-28' }),
    });
    tx.set(doc(collection(db, 'stations', uid === 'knl-station' ? 'KNL' : 'LH', 'notifications')), {
      type: 'hydrant-updated', uid, displayName: uid, hydrantId, lat, lng,
      message: `${uid} updated hydrant ${hydrantId}.`, createdAt: serverTimestamp(),
    });
  });
};
const resolveReport = (uid, hydrantId, reportId) => {
  const db = as(uid);
  const batch = writeBatch(db);
  batch.update(doc(db, 'hydrants', hydrantId, 'reports', reportId), { status: 'resolved', resolvedBy: uid, resolvedRole: 'Head', resolvedAt: serverTimestamp() });
  batch.update(doc(db, 'hydrants', hydrantId), { updatedAt: serverTimestamp(), register: arrayUnion({ statusColor: '#2fbf4f', action: 'Report resolved', by: uid, role: 'Head', date: '2026-10-28' }) });
  return batch.commit();
};

test('a station account can run the app status-edit transaction (hydrant + activity notice) in its AOR only', async () => {
  await assertSucceeds(statusEdit('knl-station', 'HYD-101', 14.65595, 121.06322));
  await assertFails(statusEdit('knl-station', 'HYD-102', 14.63371, 121.03454));
  await assertSucceeds(statusEdit('lh-station', 'HYD-102', 14.63371, 121.03454));
});

test('a station account can run the app report-resolution batch in its AOR only', async () => {
  await assertSucceeds(resolveReport('knl-station', 'HYD-101', 'r-101'));
  await assertFails(resolveReport('knl-station', 'HYD-102', 'r-102'));
});
