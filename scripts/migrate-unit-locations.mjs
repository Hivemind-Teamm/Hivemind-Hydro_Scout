import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/migrate-unit-locations.mjs --project <project-id> [--apply]');
  process.exit(0);
}
let apply = false;
let projectId = null;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--apply' && !apply) {
    apply = true;
  } else if (args[index] === '--project' && projectId === null
    && args[index + 1] && !args[index + 1].startsWith('--')) {
    projectId = args[++index];
  } else {
    throw new Error('Usage: node scripts/migrate-unit-locations.mjs --project <project-id> [--apply]');
  }
}

if (!projectId) {
  throw new Error('Specify the target Firebase project with --project.');
}

const uuidPattern = /^[a-f0-9-]{36}$/;
const stationIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const isCoordinate = (value, min, max) => typeof value === 'number'
  && Number.isFinite(value) && value >= min && value <= max;

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId });
}

const db = getFirestore();
const sources = [
  { collection: 'unitLocations', transform: migrateLegacyReport },
  { collection: 'responseLocations', transform: migrateResponseReport },
];

let copied = 0;
let alreadyPresent = 0;

for (const source of sources) {
  const snapshot = await db.collection(source.collection).get();
  let sourceCopied = 0;
  let sourceExisting = 0;
  for (const document of snapshot.docs) {
    const { stationId, data } = source.transform(document.id, document.data());
    const destination = db.doc(`stations/${stationId}/unitLocations/${document.id}`);
    if (!apply) {
      const existing = await destination.get();
      if (existing.exists) {
        assertValidDestination(source.collection, document.id, stationId, existing.data());
        sourceExisting++;
      } else sourceCopied++;
      continue;
    }

    try {
      await destination.create(data);
      sourceCopied++;
    } catch (error) {
      if (error.code === 6 || error.code === 'already-exists') {
        const existing = await destination.get();
        assertValidDestination(source.collection, document.id, stationId, existing.data());
        sourceExisting++;
        continue;
      }
      throw error;
    }
  }
  copied += sourceCopied;
  alreadyPresent += sourceExisting;
  console.log(`${source.collection}: ${snapshot.size} source documents; ${sourceCopied} ${apply ? 'copied' : 'would copy'}; ${sourceExisting} already present.`);
}

console.log(`Finished ${apply ? 'copy' : 'dry run'} for project ${projectId}.`);
console.log(`Copied/would copy: ${copied}; already present: ${alreadyPresent}.`);
if (!apply) console.log('No Firestore data was changed. Add --apply to perform the additive copy.');
else console.log('Root source documents were not modified or deleted.');

function migrateLegacyReport(id, data) {
  const stationReport = data.deviceId === undefined && id === data.stationId;
  const deviceReport = typeof data.deviceId === 'string'
    && uuidPattern.test(data.deviceId) && id === `${data.updatedBy}_${data.deviceId}`;
  if (!stationIdPattern.test(data.stationId ?? '')
    || typeof data.updatedBy !== 'string' || data.updatedBy.length < 1 || data.updatedBy.length > 128
    || (!stationReport && !deviceReport)
    || !isCoordinate(data.lat, -90, 90)
    || !isCoordinate(data.lng, -180, 180)
    || !isCoordinate(data.accuracy, 0, 40_075_000)
    || data.updatedAt === undefined || data.updatedAt === null) {
    throw new Error(`Invalid legacy unit-location document: ${id}`);
  }
  return {
    stationId: data.stationId,
    data: {
      stationId: data.stationId,
      ...(deviceReport ? { deviceId: data.deviceId } : {}),
      updatedBy: data.updatedBy,
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy,
      updatedAt: data.updatedAt,
    },
  };
}

function migrateResponseReport(id, data) {
  if (!stationIdPattern.test(data.stationId ?? '')
    || id !== data.responseId
    || !uuidPattern.test(data.responseId ?? '')
    || typeof data.stationName !== 'string'
    || data.stationName.trim().length < 1
    || data.stationName.length > 120
    || !isCoordinate(data.lat, -90, 90)
    || !isCoordinate(data.lng, -180, 180)
    || !isCoordinate(data.accuracy, 0, 40_075_000)
    || data.updatedAt === undefined || data.updatedAt === null) {
    throw new Error(`Invalid response-location document: ${id}`);
  }
  return {
    stationId: data.stationId,
    data: {
      responseId: data.responseId,
      stationId: data.stationId,
      stationName: data.stationName,
      public: true,
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy,
      updatedAt: data.updatedAt,
    },
  };
}

function assertValidDestination(collectionName, id, stationId, data) {
  if (!data || data.stationId !== stationId) {
    throw new Error(`Conflicting destination station for ${collectionName}/${id}.`);
  }

  if (collectionName === 'responseLocations') {
    const allowedKeys = [
      'responseId', 'stationId', 'stationName', 'public', 'lat', 'lng', 'accuracy', 'updatedAt',
    ];
    if (data.responseId !== id || data.public !== true
      || Object.keys(data).some(key => !allowedKeys.includes(key))
      || !allowedKeys.every(key => key in data)
      || typeof data.stationName !== 'string'
      || data.stationName.trim().length < 1 || data.stationName.length > 120
      || !isCoordinate(data.lat, -90, 90)
      || !isCoordinate(data.lng, -180, 180)
      || !isCoordinate(data.accuracy, 0, 40_075_000)
      || data.updatedAt === undefined || data.updatedAt === null) {
      throw new Error(`Conflicting or invalid destination for ${collectionName}/${id}.`);
    }
    return;
  }

  const stationReport = data.deviceId === undefined && id === stationId;
  const deviceReport = typeof data.deviceId === 'string'
    && uuidPattern.test(data.deviceId) && id === `${data.updatedBy}_${data.deviceId}`;
  if (typeof data.updatedBy !== 'string' || data.updatedBy.length < 1 || data.updatedBy.length > 128
    || (!stationReport && !deviceReport)
    || !isCoordinate(data.lat, -90, 90)
    || !isCoordinate(data.lng, -180, 180)
    || !isCoordinate(data.accuracy, 0, 40_075_000)
    || data.updatedAt === undefined || data.updatedAt === null
    || Object.keys(data).some(key => !['stationId', 'deviceId', 'updatedBy', 'lat', 'lng', 'accuracy', 'updatedAt'].includes(key))) {
    throw new Error(`Conflicting or invalid destination for ${collectionName}/${id}.`);
  }
}
