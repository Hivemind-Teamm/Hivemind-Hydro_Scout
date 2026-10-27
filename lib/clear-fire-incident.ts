import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { notificationProfile } from './limited-notification-service';

export class FireClearError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Read the incident and responders transactionally to prevent start/clear races. */
export async function clearFireIncident(db: Firestore, uid: string, id: string) {
  const profile = await notificationProfile(db, uid);
  const role = profile.accountType === 'station' ? 'head' : profile.role;
  if (!['authorized', 'head', 'admin'].includes(role)) throw new FireClearError('Not authorized to clear incidents.', 403);
  return db.runTransaction(async transaction => {
    const pinRef = db.doc(`fireIncidents/${id}`);
    const [pin, owner, responders, incidents] = await Promise.all([
      transaction.get(pinRef), transaction.get(db.doc(`fireIncidents/${id}/ownership/record`)),
      transaction.get(db.collectionGroup('responses').where('status', '==', 'active')),
      transaction.get(db.collection('fireIncidents').where('status', '==', 'active')),
    ]);
    if (!pin.exists) throw new FireClearError('Incident not found.', 404);
    const data = pin.data()!;
    const managesStation = typeof data.stationId === 'string' && ((role === 'head' && profile.stationId === data.stationId)
      || (Array.isArray(profile.stationAccessIds) && profile.stationAccessIds.includes(data.stationId)));
    if (role !== 'admin' && owner.data()?.uid !== uid && !managesStation) throw new FireClearError('Not authorized to clear this incident.', 403);
    // Older responses have no incident link. Close them when the final incident clears.
    const finalIncident = incidents.docs.every(record => record.id === id);
    const active = responders.docs.filter(record => record.data().firePinId === id
      || (!record.data().firePinId && finalIncident));
    // Read profiles before writing; avoid removing a newer response pointer.
    const profiles = await Promise.all(active.map(record => transaction.get(db.doc(`users/${record.data().uid}`))));
    const now = FieldValue.serverTimestamp();
    if (data.status === 'active') transaction.update(pinRef, { status: 'cleared', updatedAt: now });
    active.forEach((record, index) => {
      const response = record.data();
      transaction.update(record.ref, { status: 'ended', endedAt: now, endedByUid: uid,
        endedByName: profile.displayName || 'Incident coordinator', endReason: 'incident-cleared' });
      if (profiles[index].data()?.activeResponseId === record.id) transaction.update(profiles[index].ref, { activeResponseId: null });
      transaction.delete(db.doc(`stations/${response.stationId}/unitLocations/${record.id}`));
      transaction.delete(db.doc(`responseLocations/${record.id}`));
      transaction.set(db.doc(`stations/${response.stationId}/notifications/${record.id}_end`), {
        type: 'response-ended', uid: response.uid, displayName: response.displayName, responseId: record.id,
        message: `${response.displayName} ended response because the fire incident was cleared.`, createdAt: now,
      });
    });
    return { endedResponses: active.length };
  });
}
