import { auth } from './firebase';
import { getUserProfile } from './user-profile';

/** Resolve the station from the actor's profile, rather than map/client input. */
export async function mapActivityActor() {
  const user = auth.currentUser;
  if (!user) return null;
  const { data } = await getUserProfile(user.uid);
  if (!data?.stationId) return null;
  return { uid: user.uid, displayName: data.displayName || 'Responder', stationId: data.stationId as string };
}
