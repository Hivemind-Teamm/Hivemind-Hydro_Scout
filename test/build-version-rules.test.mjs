import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp, Timestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-build-versions',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
});
try {
  await env.withSecurityRulesDisabled(async context => {
    for (const role of ['admin', 'head', 'authorized', 'general']) {
      await context.firestore().doc(`users/${role}`).set({ role });
    }
    await context.firestore().doc('users/second-admin').set({ role: 'admin' });
  });
  const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
  const id = randomUUID();
  const payload = (buildId = id, uid = 'admin') => ({
    chapter: 3, version: '0.1.0', commit: 'a'.repeat(40), buildId, sourceState: 'clean',
    builtAt: Timestamp.fromMillis(1700000000000), frozenAt: serverTimestamp(), frozenBy: uid, notes: 'Chapter 3 baseline',
  });
  const ref = (uid = 'admin', buildId = id) => db(uid).doc(`buildVersions/${buildId}`);
  await assertSucceeds(ref().set(payload()));
  for (const uid of ['admin', 'second-admin']) {
    await assertSucceeds(ref(uid).get());
    await assertSucceeds(db(uid).collection('buildVersions').orderBy('frozenAt', 'desc').get());
    await assertFails(ref(uid).update({ notes: 'rewritten' }));
    await assertFails(ref(uid).set(payload(id, uid)));
    await assertFails(ref(uid).delete());
  }
  for (const uid of [null, 'head', 'authorized', 'general', 'unknown']) {
    const otherId = randomUUID();
    await assertFails(ref(uid).get());
    await assertFails(db(uid).collection('buildVersions').get());
    await assertFails(ref(uid, otherId).set(payload(otherId, uid ?? 'anonymous')));
    await assertFails(ref(uid).update({ notes: 'tampered' }));
    await assertFails(ref(uid).delete());
  }
  for (const patch of [
    { chapter: 2 }, { chapter: '3' }, { version: '' }, { version: 'v'.repeat(65) },
    { commit: 'unknown' }, { buildId: randomUUID() }, { frozenBy: 'second-admin' },
    { builtAt: Timestamp.fromMillis(Date.now() + 86400000) }, { builtAt: 'today' },
    { frozenAt: Timestamp.fromMillis(0) }, { notes: 'x'.repeat(1001) }, { notes: null }, { sourceState: 'invalid' }, { extra: true },
  ]) {
    const newId = randomUUID();
    await assertFails(ref('admin', newId).set({ ...payload(newId), ...patch }));
  }
  for (const key of Object.keys(payload())) {
    const newId = randomUUID();
    const data = payload(newId);
    delete data[key];
    await assertFails(ref('admin', newId).set(data));
  }
  const newId = randomUUID();
  await assertSucceeds(ref('second-admin', newId).set(payload(newId, 'second-admin')));
  await assertFails(ref('admin', 'invalid-id').set(payload('invalid-id')));
  console.log('Build version rules: admin-only reads/creates, immutable history, and field validation passed.');
} finally {
  await env.cleanup();
}
