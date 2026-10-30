// Admin assigns a role and station to an account (updateUserAccount in
// app/src/data/users.ts). Requires the Firestore emulator (firebase emulators:exec).
import test, { after, before } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';

let env;
const ADMIN_EMAIL = 'admin@example.com';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-account-assignment-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'stations', 'KNL'), { name: 'Krus na Ligas Fire Station', active: true, createdAt: new Date() });
    await setDoc(doc(db, 'users', 'admin'), { uid: 'admin', role: 'admin', accountType: 'person', stationId: null, stationMembershipStatus: 'none', displayName: 'Admin', email: ADMIN_EMAIL });
  });
});

after(async () => { await env?.cleanup(); });

// Same writes as updateUserAccount for a personal account.
async function assign(db, uid, role, stationId) {
  const station = await getDoc(doc(db, 'stations', stationId));
  await runTransaction(db, async transaction => {
    const [index, personal] = await Promise.all([
      transaction.get(doc(db, 'stationAccountIndex', uid)),
      transaction.get(doc(db, 'users', uid)),
    ]);
    const profile = { ...personal.data() };
    const previousStationId = profile.stationId;
    Object.assign(profile, { uid, accountType: 'person', stationId, station: station.data().name, role, stationMembershipStatus: 'approved' });
    delete profile.requestedStationId;
    transaction.set(doc(db, 'users', uid), profile);
    if (index.exists()) transaction.delete(doc(db, 'stationAccountIndex', uid));
    if (previousStationId !== stationId) {
      const targetName = profile.displayName.trim();
      transaction.set(doc(collection(db, 'stations', stationId, 'notifications'), `account-assignment-${crypto.randomUUID()}`), {
        type: 'personal-station-assigned', uid: 'admin', displayName: 'Admin', adminEmail: ADMIN_EMAIL,
        targetUid: uid, targetName,
        message: `Admin account: ${ADMIN_EMAIL} changed "${targetName}" station to ${stationId}.`,
        createdAt: serverTimestamp(),
      });
    }
  });
}

test('admin can assign a role and station to a brand-new self-signup account', async () => {
  // Exactly the fields self-signup may write: no uid and no stationId.
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'new-user'), {
    email: 'new@example.com', displayName: 'New User', role: 'general', accountType: 'person',
    stationMembershipStatus: 'none', createdAt: new Date(), lastLoginAt: new Date(),
  }));
  const admin = env.authenticatedContext('admin', { email: ADMIN_EMAIL }).firestore();
  await assertSucceeds(assign(admin, 'new-user', 'authorized', 'KNL'));
});

test('admin can assign a station to a legacy profile without accountType', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'users', 'legacy-user'), {
    email: 'legacy@example.com', displayName: 'Legacy User', role: 'general',
  }));
  const admin = env.authenticatedContext('admin', { email: ADMIN_EMAIL }).firestore();
  await assertSucceeds(assign(admin, 'legacy-user', 'head', 'KNL'));
});
