#!/usr/bin/env node
// Seeds only the local demo Firestore emulator. This script has no service
// account input and refuses every project other than demo-hydro-scout-api.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, GeoPoint, Timestamp, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-hydro-scout-api';
const EMULATOR_HOST = '127.0.0.1:8080';
const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, 'hydrant-data.json');

if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error(`Refusing to seed project ${process.env.GCLOUD_PROJECT}. Local emulator only.`);
}
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== EMULATOR_HOST) {
  throw new Error(`Refusing Firestore host ${process.env.FIRESTORE_EMULATOR_HOST}. Expected ${EMULATOR_HOST}.`);
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;

function asTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

function toDocument(record) {
  return {
    recordNo: record.recordNo,
    sourceType: record.sourceType,
    location: Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
      ? new GeoPoint(record.latitude, record.longitude)
      : null,
    address: record.address,
    nearestLandmark: record.nearestLandmark,
    barangay: typeof record.barangay === 'string' && record.barangay.trim() ? record.barangay.trim() : null,
    operationalStatus: record.operationalStatus,
    pressureStatus: record.pressureStatus,
    waterCleanliness: record.waterCleanliness,
    hazards: Array.isArray(record.hazards) ? record.hazards : [],
    hydrantColor: record.hydrantColor,
    outletCount: record.outletCount,
    outletSizeType: record.outletSizeType,
    adapterNeeded: record.adapterNeeded,
    keyWrenchNeeded: record.keyWrenchNeeded,
    ownershipJurisdiction: record.ownershipJurisdiction,
    inspector: record.inspector,
    dateInspected: asTimestamp(record.dateInspected),
    lastMaintenanceDate: asTimestamp(record.lastMaintenanceDate),
    nextMaintenanceDate: asTimestamp(record.nextMaintenanceDate),
    photoFilename: record.photoFilename,
    photoUrl: record.photoUrl,
    additionalPhotos: Array.isArray(record.additionalPhotos) ? record.additionalPhotos : [],
    notes: record.notes,
    gpsComplete: record.gpsComplete,
    followUpNeeded: record.followUpNeeded,
    importedAt: FieldValue.serverTimestamp(),
  };
}

const records = JSON.parse(await readFile(sourcePath, 'utf8'));
if (!Array.isArray(records) || records.length === 0) throw new Error('hydrant-data.json contains no hydrants.');

const app = initializeApp({ projectId: PROJECT_ID }, 'local-emulator-seeder');
const db = getFirestore(app);
let batch = db.batch();
let pending = 0;
let written = 0;

for (const record of records) {
  if (typeof record.hydrantId !== 'string' || !record.hydrantId.trim()) {
    throw new Error(`Hydrant at index ${written} has no hydrantId.`);
  }
  batch.set(db.collection('hydrants').doc(record.hydrantId.trim()), toDocument(record), { merge: true });
  pending += 1;
  written += 1;
  if (pending === 400) {
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }
}
if (pending) await batch.commit();

console.log(`Seeded ${written} hydrants into the ${PROJECT_ID} emulator at ${EMULATOR_HOST}.`);
