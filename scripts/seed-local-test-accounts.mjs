#!/usr/bin/env node
// Seeds the two local-only test accounts used for Hydro-Scout QA.
// It never reads a service account key and refuses non-emulator targets.

import { stdin as input, stdout as output } from 'node:process';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-hydro-scout-api';
const AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const ADMIN_EMAIL = 'karl.manangan@ciit.edu.ph';
const STATION_EMAIL = 'CIIT@edu.ph';
const AUTHORIZED_EMAIL = 'authorized.local@test.com';
const HEAD_EMAIL = 'head.local@test.com';
const GENERAL_EMAIL = 'general.local@test.com';
const OBSERVER_EMAIL = 'observer.local@test.com';
const PENDING_EMAIL = 'pending.local@test.com';
const QA_STATION_EMAIL = 'qa.station.local@test.com';
const STATION_ID = 'CIIT-01';
const STATION_NAME = 'CIIT Fire Station';
const QA_STATION_ID = 'QA-02';
const QA_STATION_NAME = 'QA Test Substation';

for (const [name, expected] of Object.entries({
  GCLOUD_PROJECT: PROJECT_ID,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
  FIRESTORE_EMULATOR_HOST,
})) {
  if (process.env[name] && process.env[name] !== expected) {
    throw new Error(`Refusing ${name}=${process.env[name]}. This script only seeds the local emulator.`);
  }
  process.env[name] = expected;
}

function readPassword(label) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(new Error('Run this script in an interactive terminal so passwords are not stored or echoed.'));
      return;
    }
    let value = '';
    output.write(`${label}: `);
    input.setRawMode(true);
    input.resume();
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
      if (character === '\r' || character === '\n') {
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        resolve(value);
        return;
      }
      if (character === '\u0003') {
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        reject(new Error('Cancelled.'));
        return;
      }
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += character;
      }
    };
    input.on('data', onData);
  });
}

async function upsertAuthUser(auth, email, password, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    await auth.updateUser(existing.uid, { password, displayName, disabled: false });
    return existing.uid;
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    const created = await auth.createUser({ email, password, displayName, emailVerified: true });
    return created.uid;
  }
}

const adminPassword = await readPassword(`Password for ${ADMIN_EMAIL}`);
const stationPassword = await readPassword(`Password for ${STATION_EMAIL}`);
const authorizedPassword = await readPassword(`Password for ${AUTHORIZED_EMAIL}`);
if (adminPassword.length < 6 || stationPassword.length < 6 || authorizedPassword.length < 6) {
  throw new Error('Each emulator password must have at least 6 characters.');
}

const app = initializeApp({ projectId: PROJECT_ID }, 'local-test-account-seeder');
const auth = getAuth(app);
const db = getFirestore(app);
const adminUid = await upsertAuthUser(auth, ADMIN_EMAIL, adminPassword, 'Karl Manangan');
const stationUid = await upsertAuthUser(auth, STATION_EMAIL, stationPassword, STATION_NAME);
const authorizedUid = await upsertAuthUser(auth, AUTHORIZED_EMAIL, authorizedPassword, 'Authorized QA User');
// Extra QA accounts use the authorized user's entered local-only password.
// No password is written to a file or committed.
const headUid = await upsertAuthUser(auth, HEAD_EMAIL, authorizedPassword, 'Head QA User');
const generalUid = await upsertAuthUser(auth, GENERAL_EMAIL, authorizedPassword, 'General QA User');
const observerUid = await upsertAuthUser(auth, OBSERVER_EMAIL, authorizedPassword, 'Observer QA User');
const pendingUid = await upsertAuthUser(auth, PENDING_EMAIL, authorizedPassword, 'Pending QA User');
const qaStationUid = await upsertAuthUser(auth, QA_STATION_EMAIL, authorizedPassword, QA_STATION_NAME);

const batch = db.batch();
const stationRef = db.collection('stations').doc(STATION_ID);
const qaStationRef = db.collection('stations').doc(QA_STATION_ID);
const hydrantSnapshot = await db.collection('hydrants').get();
const hydrantIds = hydrantSnapshot.docs.map(record => record.id).sort();
const aorBarangays = [...new Set(hydrantSnapshot.docs.map(record => record.data().barangay).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].sort();
const targetHydrantIds = hydrantIds.slice(0, Math.min(3, hydrantIds.length));
const activeFireId = 'QAFireIncident0000001';
const clearedFireId = 'QAFireCleared00000001';
const activeResponseId = 'qa-response-active';
const completedResponseId = 'qa-response-ended';
const activeSessionId = 'QACheckingActive00001';
const completedSessionId = 'QACheckingDone0000001';
batch.set(stationRef, {
  name: STATION_NAME,
  active: true,
  aorBarangays,
  createdAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(qaStationRef, {
  name: QA_STATION_NAME,
  active: true,
  aorBarangays: aorBarangays.slice(0, 1),
  createdAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('users').doc(adminUid), {
  uid: adminUid,
  email: ADMIN_EMAIL,
  displayName: 'Karl Manangan',
  accountType: 'person',
  role: 'admin',
  createdAt: FieldValue.serverTimestamp(),
  lastLoginAt: null,
}, { merge: true });
for (const [uid, email, displayName, role] of [
  [headUid, HEAD_EMAIL, 'Head QA User', 'head'],
  [generalUid, GENERAL_EMAIL, 'General QA User', 'general'],
  [observerUid, OBSERVER_EMAIL, 'Observer QA User', 'authorized'],
]) {
  batch.set(db.collection('users').doc(uid), {
    uid, email, displayName, accountType: 'person', role,
    station: STATION_NAME, stationId: STATION_ID,
    stationMembershipStatus: 'approved', aorBarangays: [],
    createdAt: FieldValue.serverTimestamp(), lastLoginAt: null,
  }, { merge: true });
}
batch.set(db.collection('users').doc(pendingUid), {
  uid: pendingUid, email: PENDING_EMAIL, displayName: 'Pending QA User',
  accountType: 'person', role: 'general', station: 'Unassigned',
  stationMembershipStatus: 'pending', requestedStationId: STATION_ID,
  createdAt: FieldValue.serverTimestamp(), lastLoginAt: null,
}, { merge: true });
batch.set(db.collection('users').doc(authorizedUid), {
  uid: authorizedUid,
  email: AUTHORIZED_EMAIL,
  displayName: 'Authorized QA User',
  accountType: 'person',
  role: 'authorized',
  station: STATION_NAME,
  stationId: STATION_ID,
  stationMembershipStatus: 'approved',
  aorBarangays: [],
  createdAt: FieldValue.serverTimestamp(),
  lastLoginAt: null,
}, { merge: true });
batch.set(stationRef.collection('accounts').doc(stationUid), {
  uid: stationUid,
  email: STATION_EMAIL,
  displayName: STATION_NAME,
  accountType: 'station',
  station: STATION_NAME,
  stationId: STATION_ID,
  aorBarangays: [],
  createdAt: FieldValue.serverTimestamp(),
  lastLoginAt: null,
}, { merge: true });
batch.set(db.collection('stationAccountIndex').doc(stationUid), { stationId: STATION_ID });
batch.set(qaStationRef.collection('accounts').doc(qaStationUid), {
  uid: qaStationUid, email: QA_STATION_EMAIL, displayName: QA_STATION_NAME,
  accountType: 'station', station: QA_STATION_NAME, stationId: QA_STATION_ID,
  aorBarangays: [], createdAt: FieldValue.serverTimestamp(), lastLoginAt: null,
}, { merge: true });
batch.set(db.collection('stationAccountIndex').doc(qaStationUid), { stationId: QA_STATION_ID });

// Pending approval, station activity, incident, and response fixtures.
batch.set(db.collection('stationJoinRequests').doc('qa-pending-ciit-request'), {
  uid: pendingUid, displayName: 'Pending QA User', email: PENDING_EMAIL,
  stationId: STATION_ID, status: 'pending', createdAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('firePins').doc(activeFireId), {
  lat: 14.646, lng: 121.058, stationId: STATION_ID, status: 'active',
  createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('firePinOwners').doc(activeFireId), {
  uid: authorizedUid, stationId: STATION_ID, createdAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('firePins').doc(clearedFireId), {
  lat: 14.648, lng: 121.061, stationId: STATION_ID, status: 'cleared',
  createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('firePinOwners').doc(clearedFireId), {
  uid: headUid, stationId: STATION_ID, createdAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('stationResponses').doc(activeResponseId), {
  responseId: activeResponseId, uid: headUid, displayName: 'Head QA User',
  stationId: STATION_ID, stationName: STATION_NAME, firePinId: activeFireId,
  incidentLat: 14.646, incidentLng: 121.058, status: 'active',
  startedAt: FieldValue.serverTimestamp(), endedAt: null, lastLocationAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('users').doc(headUid), { activeResponseId }, { merge: true });
batch.set(stationRef.collection('unitLocations').doc(activeResponseId), {
  responseId: activeResponseId, stationId: STATION_ID, stationName: STATION_NAME,
  public: true, lat: 14.6458, lng: 121.0577, accuracy: 15, updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
batch.set(db.collection('stationResponses').doc(completedResponseId), {
  responseId: completedResponseId, uid: observerUid, displayName: 'Observer QA User',
  stationId: STATION_ID, stationName: STATION_NAME, firePinId: clearedFireId,
  incidentLat: 14.648, incidentLng: 121.061, status: 'ended',
  startedAt: FieldValue.serverTimestamp(), endedAt: FieldValue.serverTimestamp(),
  endedByUid: headUid, endedByName: 'Head QA User', endReason: 'incident-cleared',
}, { merge: true });

for (const [id, type, uid, displayName, message, extra] of [
  ['qa-fire-active', 'fire-pinned', authorizedUid, 'Authorized QA User', 'Authorized QA User pinned a fire incident.', { firePinId: activeFireId, lat: 14.646, lng: 121.058 }],
  ['qa-fire-cleared', 'fire-cleared', headUid, 'Head QA User', 'Head QA User cleared a fire incident.', { firePinId: clearedFireId, lat: 14.648, lng: 121.061 }],
  ['qa-response-active', 'response-started', headUid, 'Head QA User', 'Head QA User started responding.', { responseId: activeResponseId }],
  ['qa-response-ended', 'response-ended', observerUid, 'Observer QA User', 'Observer QA User ended response because the fire incident was cleared.', { responseId: completedResponseId }],
]) {
  batch.set(stationRef.collection('notifications').doc(id), {
    type, uid, displayName, message, createdAt: FieldValue.serverTimestamp(), ...extra,
  }, { merge: true });
}
batch.set(qaStationRef.collection('notifications').doc('qa-substation-activity'), {
  type: 'fire-pinned', uid: qaStationUid, displayName: QA_STATION_NAME,
  message: `${QA_STATION_NAME} logged a test incident.`, lat: 14.651, lng: 121.052,
  createdAt: FieldValue.serverTimestamp(),
}, { merge: true });

if (targetHydrantIds.length) {
  batch.set(stationRef.collection('checkingSessions').doc(activeSessionId), {
    stationId: STATION_ID, name: 'QA Active Hydrant Check', status: 'active',
    targetHydrantIds, targetHydrantCount: targetHydrantIds.length,
    startedAt: FieldValue.serverTimestamp(), startedByUid: headUid, startedByName: 'Head QA User',
  }, { merge: true });
  batch.set(stationRef.collection('checkingSessions').doc(activeSessionId).collection('items').doc(targetHydrantIds[0]), {
    hydrantId: targetHydrantIds[0], status: 'checked', note: 'QA fixture: recorded.',
    checkedByUid: authorizedUid, checkedByName: 'Authorized QA User', checkedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(stationRef.collection('checkingSessions').doc(completedSessionId), {
    stationId: STATION_ID, name: 'QA Completed Hydrant Check', status: 'completed',
    targetHydrantIds, targetHydrantCount: targetHydrantIds.length,
    checkedCount: targetHydrantIds.length, pendingCount: 0, followUpCount: 1, skippedCount: 0,
    startedAt: FieldValue.serverTimestamp(), endedAt: FieldValue.serverTimestamp(),
    startedByUid: headUid, startedByName: 'Head QA User', endedByUid: headUid, endedByName: 'Head QA User',
  }, { merge: true });
  for (const [index, hydrantId] of targetHydrantIds.entries()) {
    batch.set(stationRef.collection('checkingSessions').doc(completedSessionId).collection('items').doc(hydrantId), {
      hydrantId, status: index === 1 ? 'follow-up' : 'checked', note: 'QA fixture: completed coverage.',
      checkedByUid: headUid, checkedByName: 'Head QA User', checkedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  batch.set(stationRef.collection('notifications').doc('qa-checking-active'), {
    type: 'hydrant-checking', uid: headUid, displayName: 'Head QA User', message: 'Head QA User started hydrant checking: QA Active Hydrant Check.',
    sessionId: activeSessionId, checkingStatus: 'active', checkingName: 'QA Active Hydrant Check', targetHydrantCount: targetHydrantIds.length,
    checkedCount: 1, pendingCount: Math.max(0, targetHydrantIds.length - 1), followUpCount: 0, skippedCount: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(stationRef.collection('notifications').doc('qa-checking-completed'), {
    type: 'hydrant-checking', uid: headUid, displayName: 'Head QA User', message: 'Head QA User completed hydrant checking: QA Completed Hydrant Check.',
    sessionId: completedSessionId, checkingStatus: 'completed', checkingName: 'QA Completed Hydrant Check', targetHydrantCount: targetHydrantIds.length,
    checkedCount: targetHydrantIds.length, pendingCount: 0, followUpCount: 1, skippedCount: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), endedAt: FieldValue.serverTimestamp(), endedByUid: headUid, endedByName: 'Head QA User',
  }, { merge: true });
}
await batch.commit();

console.log(`Seeded local QA accounts, stations, incident/response, notifications, approvals, and checking fixtures in ${PROJECT_ID}.`);
