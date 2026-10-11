import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : resolve(scriptDir, 'serviceAccountKey.json');

const credentials = JSON.parse(await readFile(keyPath, 'utf8'));
initializeApp({ credential: cert(credentials) });

const auth = getAuth();
const db = getFirestore();

const oldIds = new Set(['station-001', 'station-002', 'station-003']);
const expected = new Map([
  ['bfp-station-4-paligsahan', ['Kalusugan', 'Kristong Hari', 'Paligsahan', 'Roxas District']],
  ['bfp-station-4-krus-na-ligas', ['Krus na Ligas', 'UP Campus', 'UP Village', 'Botocan', 'Teachers Village East']],
  ['bfp-station-4-central', ['Central', 'Old Capitol Site']],
  ['bfp-station-4-laging-handa', ['Kamuning', 'Laging Handa', 'Obrero', 'Sacred Heart', 'South Triangle']],
]);

const accounts = [];
let nextPageToken;

do {
  const page = await auth.listUsers(1000, nextPageToken);
  accounts.push(...page.users);
  nextPageToken = page.pageToken;
} while (nextPageToken);

const counts = new Map();
const flags = new Map();

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

for (const account of accounts) {
  const snapshot = await db.collection('users').doc(account.uid).get();
  const data = snapshot.exists ? snapshot.data() : {};
  const role = data?.role ?? '(missing)';
  const stationId = data?.stationId ?? '(unassigned)';
  const aor = Array.isArray(data?.aorBarangays) ? data.aorBarangays : [];

  increment(counts, `Role: ${role}`);
  increment(counts, `Station: ${stationId}`);

  if (!snapshot.exists) increment(flags, 'Missing Firestore user document');
  if (oldIds.has(stationId)) increment(flags, 'References old placeholder station ID');

  if (role === 'authorized') {
    if (aor.length === 0) increment(flags, 'Authorized account has no AOR');

    if (expected.has(stationId)) {
      const expectedAor = expected.get(stationId);
      if (
        aor.length !== expectedAor.length ||
        !expectedAor.every((name) => aor.includes(name))
      ) {
        increment(flags, 'Authorized account AOR differs from BFP list');
      }
    } else {
      increment(flags, 'Authorized account has unrecognized station ID');
    }
  }
}

console.log('\nHydro-Scout AOR Account Audit (READ ONLY)');
console.log('----------------------------------------');
console.log('Firebase Auth accounts:', accounts.length);

for (const [label, count] of [...counts].sort()) {
  console.log(`${label}: ${count}`);
}

console.log('\nPotential issues:');
if (flags.size === 0) console.log('None detected by assignment checks.');
for (const [label, count] of [...flags].sort()) {
  console.log(`${label}: ${count}`);
}

console.log('\nNo accounts or Firestore records were modified.');
