import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required.');
const projectId = 'demo-operational-layout-migration';
const app = initializeApp({ projectId }, 'operational-layout-migration-test');
const db = getFirestore(app);
try {
  const stamp = Timestamp.fromMillis(1000);
  const batch = db.batch();
  batch.set(db.doc('users/member'), { displayName: 'Member One', stationId: 'one' });
  batch.set(db.doc('stationJoinRequests/member'), { uid: 'member', stationId: 'one', status: 'pending', createdAt: stamp });
  batch.set(db.doc('stationResponses/response'), { uid: 'member', stationId: 'one', status: 'active', startedAt: stamp });
  batch.set(db.doc('accountPresenceSessions/session'), { uid: 'member', stationId: 'one', lastSeenAt: stamp });
  batch.set(db.doc('firePins/abcdefghijklmnopqrst'), { stationId: 'one', status: 'active', createdAt: stamp });
  batch.set(db.doc('firePinOwners/abcdefghijklmnopqrst'), { uid: 'member', stationId: 'one', createdAt: stamp });
  await batch.commit();

  const preview = spawnSync(process.execPath, ['scripts/migrate-operational-layout.mjs', '--project', projectId], { encoding: 'utf8', env: process.env });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal((await db.doc('stations/one/joinRequests/member').get()).exists, false);

  const apply = spawnSync(process.execPath, ['scripts/migrate-operational-layout.mjs', '--project', projectId, '--apply'], { encoding: 'utf8', env: process.env });
  assert.equal(apply.status, 0, apply.stderr);
  for (const destination of [
    'stations/one/joinRequests/member',
    'stations/one/responses/response',
    'accountPresence/member/presenceSessions/session',
    'fireIncidents/abcdefghijklmnopqrst',
    'fireIncidents/abcdefghijklmnopqrst/ownership/record',
  ]) assert.equal((await db.doc(destination).get()).exists, true, destination);
  assert.equal((await db.doc('accountPresence/member').get()).data().displayName, 'Member One');
  assert.equal((await db.doc('stationResponses/response').get()).exists, true);
  assert.equal((await db.doc('firePins/abcdefghijklmnopqrst').get()).exists, true);
  console.log('Operational layout migration preview, copy, readable presence parent, and source retention passed.');
} finally { await deleteApp(app); }
