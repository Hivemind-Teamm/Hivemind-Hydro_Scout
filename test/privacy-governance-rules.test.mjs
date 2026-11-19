import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

let env;

const settings = db => doc(db, 'appSettings', 'locationPrivacy');
const as = uid => env.authenticatedContext(uid).firestore();

const validSettings = uid => ({
  controller: 'HydroScout Project Organization',
  contact: 'privacy@example.com',
  updatedAt: serverTimestamp(),
  updatedBy: uid,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-governance-settings',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  await env.clearFirestore();

  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();

    for (const [uid, role] of [
      ['admin-user', 'admin'],
      ['station-head', 'head'],
      ['authorized-user', 'authorized'],
      ['general-user', 'general'],
    ]) {
      await setDoc(doc(db, 'users', uid), {
        uid,
        accountType: 'person',
        role,
        stationId: role === 'admin' ? null : 'STATION-1',
        stationMembershipStatus:
          role === 'admin' ? 'none' : 'approved',
        displayName: uid,
      });
    }

    await setDoc(
      doc(db, 'stationAccountIndex', 'station-login'),
      { stationId: 'STATION-1' },
    );

    await setDoc(
      doc(db, 'stations', 'STATION-1', 'accounts', 'station-login'),
      {
        uid: 'station-login',
        accountType: 'station',
        stationId: 'STATION-1',
        displayName: 'Shared Station Login',
      },
    );
  });
});

after(async () => {
  await env?.cleanup();
});

test('only a personal Admin can create governance settings', async () => {
  await assertFails(
    setDoc(settings(as('station-head')),
      validSettings('station-head')),
  );
  await assertFails(
    setDoc(settings(as('authorized-user')),
      validSettings('authorized-user')),
  );
  await assertFails(
    setDoc(settings(as('general-user')),
      validSettings('general-user')),
  );
  await assertFails(
    setDoc(settings(as('station-login')),
      validSettings('station-login')),
  );
  await assertFails(
    setDoc(settings(env.unauthenticatedContext().firestore()),
      validSettings('anonymous')),
  );

  await assertSucceeds(
    setDoc(settings(as('admin-user')),
      validSettings('admin-user')),
  );
});

test('privacy contact details are publicly readable', async () => {
  const db = env.unauthenticatedContext().firestore();

  const result = await assertSucceeds(
    getDoc(settings(db)),
  );

  assert.equal(
    result.data().controller,
    'HydroScout Project Organization',
  );
});

test('only a personal Admin can update governance settings', async () => {
  for (const uid of [
    'station-head',
    'authorized-user',
    'general-user',
    'station-login',
  ]) {
    await assertFails(
      updateDoc(settings(as(uid)), {
        contact: 'changed@example.com',
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
  }

  await assertSucceeds(
    updateDoc(settings(as('admin-user')), {
      contact: 'new-privacy@example.com',
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-user',
    }),
  );
});

test('Admin writes require valid fields and attribution', async () => {
  const db = as('admin-user');

  await assertFails(
    updateDoc(settings(db), {
      controller: '',
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-user',
    }),
  );

  await assertFails(
    updateDoc(settings(db), {
      unexpectedField: true,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin-user',
    }),
  );

  await assertFails(
    updateDoc(settings(db), {
      contact: 'privacy@example.com',
      updatedAt: serverTimestamp(),
      updatedBy: 'someone-else',
    }),
  );

  await assertFails(
    updateDoc(settings(db), {
      contact: 'privacy@example.com',
      updatedAt: new Date('2020-01-01'),
      updatedBy: 'admin-user',
    }),
  );
});

test('privacy settings cannot be deleted', async () => {
  await assertFails(
    deleteDoc(settings(as('admin-user'))),
  );
});

test('other app settings documents stay inaccessible', async () => {
  const db = as('admin-user');
  const other = doc(db, 'appSettings', 'internalSecrets');

  await assertFails(getDoc(other));
  await assertFails(
    setDoc(other, validSettings('admin-user')),
  );
});
