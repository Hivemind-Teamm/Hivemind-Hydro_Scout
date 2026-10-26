import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator required.');
const require = createRequire(import.meta.url);
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', code)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), `${id}.ts`)) : require(id), exports);
  return exports;
}
const { clearFireIncident } = load(path.resolve('lib/clear-fire-incident.ts'));
const app = initializeApp({ projectId: 'demo-fire-clear' });
const db = getFirestore(app);
const pinId = 'abcdefghijklmnopqrst';
try {
  const now = Timestamp.now();
  await db.doc('users/creator').set({ accountType: 'person', role: 'authorized', stationId: 'one', displayName: 'Creator' });
  await db.doc('users/outsider').set({ accountType: 'person', role: 'authorized', stationId: 'two' });
  await db.doc('users/visitor').set({ accountType: 'person', role: 'general', stationId: 'one' });
  await db.doc(`fireIncidents/${pinId}`).set({ stationId: 'one', status: 'active', lat: 14.65, lng: 121.06, updatedAt: now });
  await db.doc(`fireIncidents/${pinId}/ownership/record`).set({ uid: 'creator' });
  for (const [id, stationId, firePinId] of [['a','one',pinId], ['b','two',pinId], ['c','one','anotherincidentpin00']]) {
    await db.doc(`users/${id}`).set({ activeResponseId: id });
    await db.doc(`stations/${stationId}/responses/${id}`).set({ uid: id, displayName: id, stationId, firePinId, status: 'active' });
    await db.doc(`stations/${stationId}/unitLocations/${id}`).set({ lat: 14 });
    await db.doc(`responseLocations/${id}`).set({ lat: 14 });
  }
  await assert.rejects(clearFireIncident(db, 'outsider', pinId), error => error.status === 403);
  await assert.rejects(clearFireIncident(db, 'visitor', pinId), error => error.status === 403);
  assert.equal((await db.doc(`fireIncidents/${pinId}`).get()).data().status, 'active');
  assert.equal((await clearFireIncident(db, 'creator', pinId)).endedResponses, 2);
  assert.equal((await db.doc(`fireIncidents/${pinId}`).get()).data().status, 'cleared');
  for (const [id, station] of [['a','one'],['b','two']]) {
    const response = (await db.doc(`stations/${station}/responses/${id}`).get()).data();
    assert.equal(response.status, 'ended');
    assert.equal(response.endReason, 'incident-cleared');
    assert.equal((await db.doc(`users/${id}`).get()).data().activeResponseId, null);
    assert.equal((await db.doc(`stations/${station}/unitLocations/${id}`).get()).exists, false);
    assert.equal((await db.doc(`responseLocations/${id}`).get()).exists, false);
    assert.equal((await db.doc(`stations/${station}/notifications/${id}_end`).get()).data().type, 'response-ended');
  }
  assert.equal((await db.doc('stations/one/responses/c').get()).data().status, 'active');
  assert.equal((await clearFireIncident(db, 'creator', pinId)).endedResponses, 0);
  // Preserve legacy sessions while another active incident makes their target ambiguous.
  await db.doc('fireIncidents/anotherincidentpin00').set({ status: 'active', stationId: 'one' });
  await db.doc('stations/one/responses/legacy').set({ uid: 'legacy', displayName: 'Legacy', stationId: 'one', status: 'active' });
  await db.doc('users/legacy').set({ activeResponseId: 'a-newer-response' });
  assert.equal((await clearFireIncident(db, 'creator', pinId)).endedResponses, 0);
  await db.doc('users/admin').set({ role: 'admin', accountType: 'person', displayName: 'Admin' });
  assert.equal((await clearFireIncident(db, 'admin', 'anotherincidentpin00')).endedResponses, 2);
  assert.equal((await db.doc('stations/one/responses/legacy').get()).data().status, 'ended');
  assert.equal((await db.doc('users/legacy').get()).data().activeResponseId, 'a-newer-response');
  console.log('Cross-station incident clearing, unrelated response isolation, permissions and retry checks passed.');
} finally { await deleteApp(app); }
