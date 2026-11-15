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
const STATION_ID = 'CIIT-01';
const STATION_NAME = 'CIIT Fire Station';

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
if (adminPassword.length < 6 || stationPassword.length < 6) {
  throw new Error('Each emulator password must have at least 6 characters.');
}

const app = initializeApp({ projectId: PROJECT_ID }, 'local-test-account-seeder');
const auth = getAuth(app);
const db = getFirestore(app);
const adminUid = await upsertAuthUser(auth, ADMIN_EMAIL, adminPassword, 'Karl Manangan');
const stationUid = await upsertAuthUser(auth, STATION_EMAIL, stationPassword, STATION_NAME);

const batch = db.batch();
const stationRef = db.collection('stations').doc(STATION_ID);
batch.set(stationRef, {
  name: STATION_NAME,
  active: true,
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
await batch.commit();

console.log(`Seeded local emulator accounts: admin ${ADMIN_EMAIL}; station ${STATION_EMAIL} (${STATION_ID}).`);
