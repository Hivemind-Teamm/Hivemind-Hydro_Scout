import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp, Timestamp, deleteField } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-notification-reads', firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});
const stationId = 'station-one';
const eventCreatedAt = Timestamp.fromMillis(1000);
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [uid, role, station] of [['head', 'head', stationId], ['head-two', 'head', stationId], ['outsider', 'head', 'station-two'], ['member', 'general', stationId], ['admin', 'admin', stationId]]) {
      await db.doc(`users/${uid}`).set({ role, accountType: 'person', stationId: station, stationAccessIds: [] });
    }
    await db.doc(`stations/${stationId}/notifications/notice-one`).set({ createdAt: eventCreatedAt });
    await db.doc(`stations/${stationId}/joinRequests/member`).set({ stationId, createdAt: eventCreatedAt, status: 'pending' });
    await db.doc('stations/station-two/joinRequests/other-member').set({ stationId: 'station-two', createdAt: eventCreatedAt });
  });
  const dbFor = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const path = `stations/${stationId}/notificationReads/head/items/activity_notice-one`;
  const receipt = () => ({ kind: 'activity', notificationId: 'notice-one', eventCreatedAt, readAt: serverTimestamp() });
  await assertSucceeds(dbFor('head').doc(path).set(receipt()));
  // A new authenticated session for the same UID sees the persisted receipt.
  const relogged = dbFor('head');
  const persisted = (await assertSucceeds(relogged.doc(path).get())).data();
  assert.equal(persisted.notificationId, 'notice-one');
  assert.equal(persisted.eventCreatedAt.toMillis(), 1000);
  await assertSucceeds(relogged.collection(`stations/${stationId}/notificationReads/head/items`).get());
  await assertSucceeds(relogged.doc(path).update({ readAt: serverTimestamp() }));

  for (const uid of [null, 'head-two', 'outsider', 'member', 'admin']) {
    await assertFails(dbFor(uid).doc(path).get());
    await assertFails(dbFor(uid).doc(path).set(receipt()));
    await assertFails(dbFor(uid).collection(`stations/${stationId}/notificationReads/head/items`).get());
  }
  const otherOwnPath = `stations/${stationId}/notificationReads/head-two/items/activity_notice-one`;
  assert.equal((await dbFor('head-two').doc(otherOwnPath).get()).exists, false);
  await assertSucceeds(dbFor('head-two').doc(otherOwnPath).set(receipt()));

  for (const patch of [
    { kind: 'other' }, { notificationId: 'missing' }, { notificationId: '../notice-one' },
    { notificationId: 'a'.repeat(257) }, { eventCreatedAt: Timestamp.fromMillis(2) },
    { readAt: Timestamp.fromMillis(0) }, { eventCreatedAt: '1000' }, { extra: true },
  ]) {
    await assertFails(relogged.doc(path).set({ ...receipt(), ...patch }));
    await assertFails(relogged.doc(path).update({ ...patch, ...(patch.readAt ? {} : { readAt: serverTimestamp() }) }));
  }
  for (const field of Object.keys(receipt())) {
    const incomplete = receipt(); delete incomplete[field];
    await assertFails(relogged.doc(path).set(incomplete));
    await assertFails(relogged.doc(path).update({ [field]: deleteField() }));
  }
  await assertFails(relogged.doc(path).delete());
  await assertFails(relogged.doc(path + '/nested/injected').set(receipt()));

  const memberPath = `stations/${stationId}/notificationReads/head/items/member_member`;
  await assertSucceeds(relogged.doc(memberPath).set({ ...receipt(), kind: 'member', notificationId: 'member' }));
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await context.firestore().doc(`stations/${stationId}/joinRequests/member`).get()).data().status, 'pending');
  });
  await assertFails(relogged.doc(`stations/${stationId}/notificationReads/head/items/member_other-member`).set({ ...receipt(), kind: 'member', notificationId: 'other-member' }));

  // A new event version must not inherit an old read receipt.
  await env.withSecurityRulesDisabled(context => context.firestore().doc(`stations/${stationId}/notifications/notice-one`).update({ createdAt: Timestamp.fromMillis(2000) }));
  await assertFails(relogged.doc(path).set(receipt()));
  await assertSucceeds(relogged.doc(path).set({ ...receipt(), eventCreatedAt: Timestamp.fromMillis(2000) }));
  await env.withSecurityRulesDisabled(context => context.firestore().doc('users/head').update({ role: 'general', stationAccessIds: [] }));
  await assertFails(relogged.doc(path).get());
  await assertFails(relogged.doc(path).set({ ...receipt(), eventCreatedAt: Timestamp.fromMillis(2000) }));
  console.log('Notification read receipts: all authorization and persistence checks passed.');
} finally { await env.cleanup(); }
