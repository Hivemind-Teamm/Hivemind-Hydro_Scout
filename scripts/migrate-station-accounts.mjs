import { isDeepStrictEqual } from 'node:util';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/migrate-station-accounts.mjs --project <project-id> [--apply] [--delete-source]');
  process.exit(0);
}

let apply = false;
let deleteSource = false;
let projectId = null;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--apply' && !apply) {
    apply = true;
  } else if (args[index] === '--delete-source' && !deleteSource) {
    deleteSource = true;
  } else if (args[index] === '--project' && projectId === null
    && args[index + 1] && !args[index + 1].startsWith('--')) {
    projectId = args[++index];
  } else {
    throw new Error('Usage: node scripts/migrate-station-accounts.mjs --project <project-id> [--apply] [--delete-source]');
  }
}

if (!projectId) throw new Error('Specify the target Firebase project with --project.');
if (deleteSource && !apply) throw new Error('--delete-source requires --apply.');

const stationIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const allowedRoles = new Set(['authorized', 'head', 'admin']);
if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId });
}

const db = getFirestore();
const sources = await db.collection('users').where('accountType', '==', 'station').get();
const records = [];

for (const source of sources.docs) {
  const uid = source.id;
  const profile = source.data();
  const stationId = profile.stationId;
  if (typeof stationId !== 'string' || !stationIdPattern.test(stationId)) {
    throw new Error(`Station account ${uid} has an invalid stationId.`);
  }
  if (!allowedRoles.has(profile.role)) {
    throw new Error(`Station account ${uid} has an invalid role.`);
  }

  const station = await db.doc(`stations/${stationId}`).get();
  if (!station.exists) throw new Error(`Station account ${uid} refers to missing station ${stationId}.`);
  const displayName = typeof profile.displayName === 'string'
    ? profile.displayName.trim()
    : typeof profile.email === 'string' ? profile.email.split('@')[0] : '';
  const stationName = typeof profile.station === 'string' && profile.station.trim()
    ? profile.station.trim()
    : String(station.data()?.name ?? '').trim();
  if (typeof profile.email !== 'string' || profile.email.length > 254
    || displayName.length > 120 || stationName.length < 1 || stationName.length > 120
    || !(profile.createdAt instanceof Timestamp)
    || (profile.lastLoginAt !== null && !(profile.lastLoginAt instanceof Timestamp))) {
    throw new Error(`Station account ${uid} has profile fields that need manual review.`);
  }
  const aorBarangays = Array.isArray(profile.aorBarangays)
    ? profile.aorBarangays.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean)
    : [];
  if (aorBarangays.length > 100
    || (profile.stationAccessIds !== undefined
      && (!Array.isArray(profile.stationAccessIds) || profile.stationAccessIds.length > 10
        || profile.stationAccessIds.some(value => typeof value !== 'string')))) {
    throw new Error(`Station account ${uid} has invalid station access or AOR data.`);
  }

  const accountProfile = {
    uid,
    email: profile.email,
    displayName: stationName,
    accountType: 'station',
    station: stationName,
    stationId,
    aorBarangays: [],
    ...(Array.isArray(profile.stationAccessIds) ? { stationAccessIds: profile.stationAccessIds } : {}),
    createdAt: profile.createdAt,
    lastLoginAt: profile.lastLoginAt,
  };
  const accountRef = db.doc(`stations/${stationId}/accounts/${uid}`);
  const indexRef = db.doc(`stationAccountIndex/${uid}`);
  const [accountSnapshot, indexSnapshot] = await Promise.all([accountRef.get(), indexRef.get()]);

  if (indexSnapshot.exists && !isDeepStrictEqual(indexSnapshot.data(), { stationId })) {
    throw new Error(`Station-account index conflicts with source for ${uid}.`);
  }
  if (accountSnapshot.exists) {
    const existingProfile = accountSnapshot.data();
    const isAlreadyIndexed = indexSnapshot.exists
      && existingProfile.uid === uid
      && existingProfile.accountType === 'station'
      && existingProfile.stationId === stationId
      && !('role' in existingProfile)
      && typeof existingProfile.email === 'string'
      && existingProfile.email.length <= 254
      && existingProfile.displayName === stationName
      && typeof existingProfile.station === 'string'
      && existingProfile.station.length > 0
      && existingProfile.station.length <= 120
      && Array.isArray(existingProfile.aorBarangays)
      && existingProfile.aorBarangays.length === 0
      && existingProfile.createdAt instanceof Timestamp
      && (existingProfile.lastLoginAt === null || existingProfile.lastLoginAt instanceof Timestamp);
    if (!isDeepStrictEqual(existingProfile, accountProfile) && !isAlreadyIndexed) {
      throw new Error(`Destination profile conflicts with source for ${uid}.`);
    }
  }
  const verifiedProfile = accountSnapshot.exists ? accountSnapshot.data() : accountProfile;

  if (apply) {
    if (!accountSnapshot.exists || !indexSnapshot.exists) {
      const batch = db.batch();
      if (!accountSnapshot.exists) batch.set(accountRef, accountProfile);
      if (!indexSnapshot.exists) batch.set(indexRef, { stationId });
      await batch.commit();
    }

    const [verifiedAccount, verifiedIndex] = await Promise.all([accountRef.get(), indexRef.get()]);
    if (!verifiedAccount.exists || !isDeepStrictEqual(verifiedAccount.data(), verifiedProfile)
      || !verifiedIndex.exists || !isDeepStrictEqual(verifiedIndex.data(), { stationId })) {
      throw new Error(`Could not verify the migrated profile for ${uid}; source was preserved.`);
    }
  }

  records.push({
    uid, stationId, sourceData: profile, verifiedProfile,
    sourceRef: source.ref, accountRef, indexRef,
  });
}

console.log(`${sources.size} station account profile(s) ${apply ? 'copied and verified' : 'would be copied'} in ${projectId}.`);

if (!apply) {
  console.log('No Firestore data was changed. Add --apply to copy profiles and create account indexes.');
} else if (deleteSource) {
  for (const record of records) {
    await db.runTransaction(async transaction => {
      const [source, account, index] = await Promise.all([
        transaction.get(record.sourceRef),
        transaction.get(record.accountRef),
        transaction.get(record.indexRef),
      ]);
      if (!source.exists) return;
      if (!isDeepStrictEqual(source.data(), record.sourceData)
        || !account.exists || !isDeepStrictEqual(account.data(), record.verifiedProfile)
        || !index.exists || !isDeepStrictEqual(index.data(), { stationId: record.stationId })) {
        throw new Error(`Source or destination changed after verification for ${record.uid}; source was preserved.`);
      }
      transaction.delete(record.sourceRef);
    });
  }
  console.log('Deleted source users/{uid} profiles only after verifying the station profile and index.');
} else {
  console.log('Source users/{uid} profiles were preserved. Re-run with --apply --delete-source only after deploying the new app and rules.');
}
