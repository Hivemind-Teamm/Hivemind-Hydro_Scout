import type { Firestore, DocumentData } from 'firebase-admin/firestore';

/**
 * The verified viewer's profile, read with Firebase Admin: a station account
 * (only while its index, account document and active station agree) or the
 * personal profile. Returns {} when the profile cannot be trusted.
 */
export async function verifiedProfile(db: Firestore, uid: string): Promise<DocumentData> {
  const index = await db.doc(`stationAccountIndex/${uid}`).get();
  if (!index.exists) return (await db.doc(`users/${uid}`).get()).data() ?? {};
  const stationId = index.data()?.stationId;
  if (typeof stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)) return {};
  const [account, station] = await Promise.all([
    db.doc(`stations/${stationId}/accounts/${uid}`).get(), db.doc(`stations/${stationId}`).get(),
  ]);
  const profile = account.data();
  return station.data()?.active === true && profile?.uid === uid && profile?.accountType === 'station' && profile?.stationId === stationId ? profile : {};
}
