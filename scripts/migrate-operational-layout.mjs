import { readFile } from 'node:fs/promises';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const usage = 'Usage: node scripts/migrate-operational-layout.mjs --project <project-id> [--apply]';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(usage);
  process.exit(0);
}

let projectId = null;
let apply = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--project' && !projectId && args[index + 1] && !args[index + 1].startsWith('--')) {
    projectId = args[++index];
  } else if (args[index] === '--apply' && !apply) {
    apply = true;
  } else {
    throw new Error(usage);
  }
}
if (!projectId) throw new Error(usage);

async function productionCredential() {
  const envText = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '');
  const line = envText.split(/\r?\n/).find(candidate => candidate.trim().startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='));
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || line?.slice(line.indexOf('=') + 1).trim();
  if (raw && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) raw = raw.slice(1, -1);
  if (!raw) return applicationDefault();
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.project_id !== projectId) {
    throw new Error(`Service account project ${serviceAccount.project_id} does not match requested project ${projectId}.`);
  }
  if (typeof serviceAccount.private_key === 'string') serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  return cert(serviceAccount);
}

if (getApps().length === 0) initializeApp(process.env.FIRESTORE_EMULATOR_HOST
  ? { projectId }
  : { credential: await productionCredential(), projectId });
const db = getFirestore();
const copies = [];
const presenceParents = new Map();

function firestoreValueEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left == null || right == null || typeof left !== typeof right) return false;
  if (typeof left?.isEqual === 'function') return left.isEqual(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => firestoreValueEqual(value, right[index]));
  }
  if (typeof left === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && firestoreValueEqual(left[key], right[key]));
  }
  return false;
}

function stationIdOf(source, label) {
  const stationId = source.data().stationId;
  if (typeof stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) {
    throw new Error(`${label} ${source.ref.path} has no valid stationId.`);
  }
  return stationId;
}

async function collectStationChildren(sourceCollection, destinationCollection) {
  const snapshot = await db.collection(sourceCollection).get();
  for (const source of snapshot.docs) {
    const stationId = stationIdOf(source, sourceCollection);
    copies.push({ source, destination: db.doc(`stations/${stationId}/${destinationCollection}/${source.id}`) });
  }
}

await collectStationChildren('stationJoinRequests', 'joinRequests');
await collectStationChildren('stationResponses', 'responses');

const presence = await db.collection('accountPresenceSessions').get();
for (const source of presence.docs) {
  const uid = source.data().uid;
  if (typeof uid !== 'string' || !uid) throw new Error(`Presence session ${source.ref.path} has no uid.`);
  copies.push({ source, destination: db.doc(`accountPresence/${uid}/presenceSessions/${source.id}`) });
  if (!presenceParents.has(uid)) {
    const [user, stationIndex] = await Promise.all([
      db.doc(`users/${uid}`).get(),
      db.doc(`stationAccountIndex/${uid}`).get(),
    ]);
    let profile = user.data();
    if (!profile && stationIndex.exists) {
      const stationId = stationIndex.data()?.stationId;
      if (typeof stationId === 'string') profile = (await db.doc(`stations/${stationId}/accounts/${uid}`).get()).data();
    }
    presenceParents.set(uid, {
      uid,
      stationId: source.data().stationId ?? profile?.stationId ?? null,
      displayName: profile?.displayName || profile?.email || uid,
    });
  }
}

const incidents = await db.collection('firePins').get();
for (const source of incidents.docs) {
  copies.push({ source, destination: db.doc(`fireIncidents/${source.id}`) });
}
const owners = await db.collection('firePinOwners').get();
for (const source of owners.docs) {
  copies.push({ source, destination: db.doc(`fireIncidents/${source.id}/ownership/record`) });
}

for (const copy of copies) {
  const existing = await copy.destination.get();
  if (existing.exists && !firestoreValueEqual(existing.data(), copy.source.data())) {
    throw new Error(`Destination ${copy.destination.path} conflicts with ${copy.source.ref.path}. No writes were made.`);
  }
}

const summary = {
  stationJoinRequests: copies.filter(item => item.source.ref.parent.id === 'stationJoinRequests').length,
  stationResponses: copies.filter(item => item.source.ref.parent.id === 'stationResponses').length,
  accountPresenceSessions: presence.size,
  firePins: incidents.size,
  firePinOwners: owners.size,
};
console.table(summary);

if (!apply) {
  console.log('Preview complete. No Firestore data was changed. Add --apply to copy records while retaining every source document.');
  process.exit(0);
}

let batch = db.batch();
let operations = 0;
async function commitIfFull() {
  if (operations < 400) return;
  await batch.commit();
  batch = db.batch();
  operations = 0;
}
for (const copy of copies) {
  batch.set(copy.destination, copy.source.data());
  operations += 1;
  await commitIfFull();
}
for (const [uid, data] of presenceParents) {
  batch.set(db.doc(`accountPresence/${uid}`), data, { merge: true });
  operations += 1;
  await commitIfFull();
}
if (operations) await batch.commit();

console.log(`Copied ${copies.length} operational record(s) and ${presenceParents.size} presence heading(s).`);
console.log('Legacy source collections were retained for rollback. This script never deletes source data.');
