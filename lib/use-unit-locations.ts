'use client';

import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { useAuth } from './auth-context';
import { db } from './firebase';
import { stationIdForLocation } from './unit-location';
import { mapUnitLocation, type MapUnitLocation } from './map-unit-location';

export function useUnitLocations() {
  const { user, role, loading } = useAuth();
  const uid = user?.uid;
  const scope = !loading && uid ? `${uid}:${role}` : null;
  const [state, setState] = useState<{
    scope: string | null; locations: MapUnitLocation[]; error: boolean;
  }>({ scope: null, locations: [], error: false });

  useEffect(() => {
    if (!scope || !uid) return;
    let active = true;
    let stopLocations: Unsubscribe | undefined;
    let generation = 0;
    const publish = (locations: MapUnitLocation[], error = false) => {
      if (active) setState({ scope, locations, error });
    };
    const fail = (error: unknown) => {
      console.warn('Unit location listener failed:', error);
      publish([], true);
    };
    if (role === 'admin') {
      stopLocations = onSnapshot(collection(db, 'unitLocations'), snapshot => {
        publish(snapshot.docs.flatMap(record => {
          const location = mapUnitLocation(record.id, record.data());
          return location ? [location] : [];
        }));
      }, fail);
    }
    // Observe profile changes so reassignment also replaces the station listener.
    const stopProfile = role === 'admin' ? undefined : onSnapshot(doc(db, 'users', uid), snapshot => {
      const currentGeneration = ++generation;
      stopLocations?.();
      stopLocations = undefined;
      publish([]);
      const stationId = stationIdForLocation(snapshot.data());
      if (!stationId) return;
      stopLocations = onSnapshot(doc(db, 'unitLocations', stationId), record => {
        if (currentGeneration !== generation) return;
        const location = record.exists() ? mapUnitLocation(record.id, record.data()) : null;
        publish(location ? [location] : []);
      }, error => { if (currentGeneration === generation) fail(error); });
    }, error => {
      ++generation;
      stopLocations?.();
      stopLocations = undefined;
      fail(error);
    });
    return () => {
      active = false;
      stopProfile?.();
      stopLocations?.();
    };
  }, [scope, uid, role]);

  // Never render another session's cached markers while effect cleanup runs.
  return state.scope === scope && scope ? state : { locations: [], error: false };
}
