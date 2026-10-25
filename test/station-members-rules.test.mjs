import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import assert from 'node:assert/strict';

const env = await initializeTestEnvironment({ projectId: 'demo-station-members', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, role, stationId] of [['head', 'head', 'one'], ['admin', 'admin', null], ['member', 'authorized', 'one'], ['other', 'head', 'two'], ['general', 'general', 'one']]) {
      await db.doc(`users/${uid}`).set({ role, accountType: 'person', stationId });
    }
    await db.doc('stationAccountIndex/station').set({ stationId: 'one' });
    await db.doc('stations/one/accounts/station').set({ uid: 'station', accountType: 'station', stationId: 'one' });
    await db.doc('accountPresenceSessions/00000000-0000-4000-8000-000000000001').set({ uid: 'member', stationId: 'one', lastSeenAt: new Date() });
    await db.doc('stationResponses/responding').set({ uid: 'member', stationId: 'one', status: 'active' });
  });
  const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const roster = db => db.collection('users').where('stationId', '==', 'one').where('accountType', '==', 'person').get();
  for (const uid of ['head', 'admin', 'station']) {
    const db = dbFor(uid);
    const members = await assertSucceeds(roster(db));
    assert.equal(members.docs.some(record => record.id === 'other'), false);
    await assertSucceeds(db.collection('accountPresenceSessions').where('stationId', '==', 'one').get());
    await assertSucceeds(db.collection('stationResponses').where('stationId', '==', 'one').get());
  }
  for (const uid of [null, 'member', 'general', 'other']) {
    const db = dbFor(uid);
    await assertFails(roster(db));
    await assertFails(db.collection('accountPresenceSessions').where('stationId', '==', 'one').get());
    await assertFails(db.collection('stationResponses').where('stationId', '==', 'one').get());
  }
  console.log('Station roster/profile, presence and response queries: manager access and cross-station/public/member denial passed.');
} finally { await env.cleanup(); }
