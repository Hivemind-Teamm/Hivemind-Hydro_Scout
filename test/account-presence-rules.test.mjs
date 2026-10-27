import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp, Timestamp, deleteField } from 'firebase/firestore';

const env = await initializeTestEnvironment({ projectId: 'demo-account-presence', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, role, stationId] of [['admin', 'admin', null], ['head', 'head', 'one'], ['member', 'authorized', 'one'], ['outsider', 'head', 'two'], ['general', 'general', null]]) {
      await db.doc(`users/${uid}`).set({ accountType: 'person', role, stationId });
    }
    await db.doc('stationAccountIndex/station').set({ stationId: 'one' });
    await db.doc('stations/one/accounts/station').set({ uid: 'station', accountType: 'station', stationId: 'one' });
  });
  const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const data = (uid = 'member', stationId = 'one') => ({ uid, stationId, lastSeenAt: serverTimestamp() });
  const member = dbFor('member');
  const path = `accountPresenceSessions/${first}`;
  await assertSucceeds(member.doc(path).set(data()));
  await assertSucceeds(member.doc(path).set(data()));
  await assertSucceeds(member.doc(path).get());
  await assertSucceeds(dbFor('admin').collection('accountPresenceSessions').where('lastSeenAt', '>', Timestamp.fromMillis(0)).get());
  await assertSucceeds(dbFor('head').collection('accountPresenceSessions').where('uid', '==', 'member').where('stationId', '==', 'one').get());
  for (const uid of [null, 'outsider', 'general']) {
    await assertFails(dbFor(uid).doc(path).get());
    await assertFails(dbFor(uid).doc(path).set(data()));
    await assertFails(dbFor(uid).doc(path).delete());
  }
  for (const patch of [{ uid: 'head' }, { stationId: 'two' }, { lastSeenAt: Timestamp.fromMillis(0) }, { extra: true }]) {
    await assertFails(member.doc(path).set({ ...data(), ...patch }));
  }
  for (const field of ['uid', 'stationId', 'lastSeenAt']) await assertFails(member.doc(path).update({ [field]: deleteField() }));
  await assertFails(dbFor('head').doc(path).update({ lastSeenAt: serverTimestamp() }));
  await assertFails(member.doc('accountPresenceSessions/not-a-session').set(data()));
  await assertSucceeds(member.doc(`accountPresenceSessions/${second}`).set(data()));
  await assertSucceeds(member.doc(path).delete());
  await assertSucceeds(member.doc(`accountPresenceSessions/${second}`).get());
  await assertSucceeds(dbFor('general').doc('accountPresenceSessions/00000000-0000-4000-8000-000000000003').set(data('general', null)));
  await assertSucceeds(dbFor('station').doc('accountPresenceSessions/00000000-0000-4000-8000-000000000004').set(data('station')));
  await assertFails(dbFor('station').collection('accountPresenceSessions').get());
  console.log('Account presence ownership, station privacy, immutable identity, session isolation and timestamp checks passed.');
} finally { await env.cleanup(); }
