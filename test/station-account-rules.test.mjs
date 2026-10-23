import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp } from 'firebase/firestore';
import assert from 'node:assert/strict';

const env = await initializeTestEnvironment({
  projectId: 'demo-station-account-profiles',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('users/admin').set({ uid: 'admin', role: 'admin' });
    await db.doc('stations/STATION-1').set({ name: 'Station One', active: true });
    await db.doc('stations/STATION-1/accounts/legacy-station-user').set({
      uid: 'legacy-station-user',
      email: 'legacy-station@example.test',
      displayName: 'Station One',
      role: 'admin',
      accountType: 'station',
      station: 'Station One',
      stationId: 'STATION-1',
      aorBarangays: [],
      createdAt: new Date(),
      lastLoginAt: null,
    });
    await db.doc('stationAccountIndex/legacy-station-user').set({ stationId: 'STATION-1' });
  });

  const admin = env.authenticatedContext('admin').firestore();
  const newStationProfile = {
    uid: 'new-station-user',
    email: 'new-station@example.test',
    displayName: 'New Station',
    accountType: 'station',
    station: 'New Station',
    stationId: 'STATION-2',
    aorBarangays: [],
    createdAt: serverTimestamp(),
    lastLoginAt: null,
  };
  const createStationWithLogin = admin.batch();
  createStationWithLogin.set(admin.doc('stations/STATION-2'), {
    name: 'New Station',
    active: true,
    createdAt: serverTimestamp(),
  });
  createStationWithLogin.set(admin.doc('stations/STATION-2/accounts/new-station-user'), newStationProfile);
  createStationWithLogin.set(admin.doc('stationAccountIndex/new-station-user'), { stationId: 'STATION-2' });
  await assertSucceeds(createStationWithLogin.commit());

  const stationWithRole = admin.batch();
  stationWithRole.set(admin.doc('stations/STATION-3'), {
    name: 'Station With Role',
    active: true,
    createdAt: serverTimestamp(),
  });
  stationWithRole.set(admin.doc('stations/STATION-3/accounts/roleful-station-user'), {
    ...newStationProfile,
    uid: 'roleful-station-user',
    displayName: 'Station With Role',
    role: 'head',
    station: 'Station With Role',
    stationId: 'STATION-3',
  });
  stationWithRole.set(admin.doc('stationAccountIndex/roleful-station-user'), { stationId: 'STATION-3' });
  await assertFails(stationWithRole.commit());

  const unauthenticated = env.unauthenticatedContext().firestore();
  await assertFails(unauthenticated.doc('stations/STATION-3').set({
    name: 'Unauthorized Station',
    active: true,
    createdAt: serverTimestamp(),
  }));

  const profile = {
    uid: 'station-user',
    email: 'station@example.test',
    displayName: 'Station One',
    accountType: 'station',
    station: 'Station One',
    stationId: 'STATION-1',
    aorBarangays: [],
    createdAt: serverTimestamp(),
    lastLoginAt: null,
  };
  const create = admin.batch();
  create.set(admin.doc('stations/STATION-1/accounts/station-user'), profile);
  create.set(admin.doc('stationAccountIndex/station-user'), { stationId: 'STATION-1' });
  await assertSucceeds(create.commit());

  const stationUser = env.authenticatedContext('station-user').firestore();
  await assertSucceeds(stationUser.doc('stationAccountIndex/station-user').get());
  await assertSucceeds(stationUser.doc('stations/STATION-1/accounts/station-user').get());
  await assertSucceeds(stationUser.doc('stations/STATION-1/accounts/station-user').update({
    lastLoginAt: serverTimestamp(),
  }));
  await assertFails(stationUser.doc('stations/STATION-1/accounts/station-user').update({ role: 'admin' }));
  await assertFails(stationUser.doc('buildVersions/current').get());
  await assertFails(stationUser.doc('stationAccountIndex/station-user').update({ stationId: 'STATION-2' }));

  const legacyStationUser = env.authenticatedContext('legacy-station-user').firestore();
  await assertSucceeds(legacyStationUser.doc('stations/STATION-1/accounts/legacy-station-user').update({
    lastLoginAt: serverTimestamp(),
  }));
  await assertFails(legacyStationUser.doc('stations/STATION-1/accounts/legacy-station-user').update({ role: 'admin' }));
  await assertFails(legacyStationUser.doc('buildVersions/current').get());

  const otherUser = env.authenticatedContext('other-user').firestore();
  await assertFails(otherUser.doc('stationAccountIndex/station-user').get());
  await assertFails(otherUser.doc('stations/STATION-1/accounts/station-user').get());

  const stationAccounts = await admin.collectionGroup('accounts')
    .where('accountType', '==', 'station').get();
  assert.equal(stationAccounts.size, 3);
  assert.deepEqual(stationAccounts.docs.map(account => account.id).sort(), [
    'legacy-station-user',
    'new-station-user',
    'station-user',
  ]);

  const moveToPersonal = admin.batch();
  moveToPersonal.set(admin.doc('users/station-user'), {
    uid: 'station-user',
    email: 'station@example.test',
    displayName: 'Station User',
    role: 'general',
    accountType: 'person',
    station: 'Unassigned',
    stationId: null,
    stationMembershipStatus: 'none',
    createdAt: serverTimestamp(),
    lastLoginAt: null,
  });
  moveToPersonal.delete(admin.doc('stations/STATION-1/accounts/station-user'));
  moveToPersonal.delete(admin.doc('stationAccountIndex/station-user'));
  await assertSucceeds(moveToPersonal.commit());
  await assertSucceeds(stationUser.doc('users/station-user').get());

  console.log('Station account rules: all checks passed');
} finally {
  await env.cleanup();
}
