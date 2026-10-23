import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getUserProfile } from './user-profile';

/** Resolve the station from the actor's profile, rather than map/client input. */
export async function mapActivityActor() {
  const user = auth.currentUser;
  if (!user) return null;
  const { data } = await getUserProfile(user.uid);
  if (!data?.stationId) return null;
  return { uid: user.uid, displayName: data.displayName || 'Responder', stationId: data.stationId as string };
}

export async function notifyFirePin(lat: number, lng: number) {
  const actor = await mapActivityActor();
  if (!actor) return;
  await addDoc(collection(db, 'stations', actor.stationId, 'notifications'), {
    type: 'fire-pinned', uid: actor.uid, displayName: actor.displayName,
    lat, lng, message: `${actor.displayName} pinned a fire incident.`, createdAt: serverTimestamp(),
  });
}
