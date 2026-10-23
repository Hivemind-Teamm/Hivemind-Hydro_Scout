import {
  doc,
  getDoc,
  onSnapshot,
  type DocumentData,
  type DocumentReference,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

const stationIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

export interface UserProfile {
  ref: DocumentReference<DocumentData>;
  data: DocumentData | undefined;
}

export function userProfileRef(uid: string) {
  return doc(db, 'users', uid);
}

export function stationAccountRef(stationId: string, uid: string) {
  return doc(db, 'stations', stationId, 'accounts', uid);
}

export function stationAccountIndexRef(uid: string) {
  return doc(db, 'stationAccountIndex', uid);
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'permission-denied';
}

async function getPersonalProfile(uid: string): Promise<UserProfile> {
  const ref = userProfileRef(uid);
  const snapshot = await getDoc(ref);
  return { ref, data: snapshot.exists() ? snapshot.data() : undefined };
}

export async function getUserProfile(uid: string): Promise<UserProfile> {
  let index;
  try {
    index = await getDoc(stationAccountIndexRef(uid));
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    return getPersonalProfile(uid);
  }

  if (!index.exists()) {
    return getPersonalProfile(uid);
  }

  const stationId = index.data().stationId;
  if (typeof stationId !== 'string' || !stationIdPattern.test(stationId)) {
    throw new Error('The station account index contains an invalid station ID.');
  }

  const ref = stationAccountRef(stationId, uid);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new Error('The station account index points to a missing station profile.');
  }
  return { ref, data: snapshot.data() };
}

export function watchUserProfile(
  uid: string,
  onProfile: (data: DocumentData | undefined) => void,
  onError: (error: FirestoreError | Error) => void,
): Unsubscribe {
  let stopped = false;
  let generation = 0;
  let stopProfile: Unsubscribe | undefined;

  const watchPersonalProfile = (currentGeneration: number) => {
    stopProfile = onSnapshot(
      userProfileRef(uid),
      profile => {
        if (!stopped && generation === currentGeneration) {
          onProfile(profile.exists() ? profile.data() : undefined);
        }
      },
      onError,
    );
  };

  const fallBackToPersonalProfile = (error: FirestoreError) => {
    if (!isPermissionDenied(error) || stopped) {
      onError(error);
      return;
    }
    const currentGeneration = ++generation;
    stopProfile?.();
    stopProfile = undefined;
    watchPersonalProfile(currentGeneration);
  };

  const stopIndex = onSnapshot(
    stationAccountIndexRef(uid),
    index => {
      const currentGeneration = ++generation;
      stopProfile?.();
      stopProfile = undefined;

      if (!index.exists()) {
        watchPersonalProfile(currentGeneration);
        return;
      }

      const stationId = index.data().stationId;
      if (typeof stationId !== 'string' || !stationIdPattern.test(stationId)) {
        onProfile(undefined);
        onError(new Error('The station account index contains an invalid station ID.'));
        return;
      }

      stopProfile = onSnapshot(
        stationAccountRef(stationId, uid),
        profile => {
          if (!stopped && generation === currentGeneration) {
            if (!profile.exists()) {
                onProfile(undefined);
                onError(new Error('The station account index points to a missing station profile.'));
                return;
              }
              onProfile(profile.data());
            }
        },
        fallBackToPersonalProfile,
      );
    },
    fallBackToPersonalProfile,
  );

  return () => {
    stopped = true;
    generation++;
    stopProfile?.();
    stopIndex();
  };
}
