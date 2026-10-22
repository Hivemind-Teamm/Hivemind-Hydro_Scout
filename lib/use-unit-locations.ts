'use client';

import { useEffect, useState } from 'react';
import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from './auth-context';
import { db } from './firebase';
import { mapUnitLocation, type MapUnitLocation } from './map-unit-location';
import { locationTimeoutMs, watchUnitLocationExpiry } from './unit-location-expiry';

const TIMEOUT_MS = locationTimeoutMs(process.env.NEXT_PUBLIC_UNIT_LOCATION_TIMEOUT_MINUTES);

export function useUnitLocations() {
  const { user, loading } = useAuth();
  const uid = user?.uid;
  const scope = !loading && uid ? uid : null;
  const [state, setState] = useState<{
    scope: string | null; locations: MapUnitLocation[]; error: boolean;
  }>({ scope: null, locations: [], error: false });

  useEffect(() => {
    if (!scope || !uid) return;
    let active = true;
    let locationError = false;
    const expiry = watchUnitLocationExpiry(locations => {
      if (active) setState({ scope, locations, error: locationError });
    }, TIMEOUT_MS);
    const publish = (locations: MapUnitLocation[], error = false) => {
      locationError = error;
      if (active) expiry.update(locations);
    };
    // Background tabs may throttle timers; recheck immediately on return.
    const resume = () => { if (document.visibilityState === 'visible') expiry.refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', expiry.refresh);
    const fail = (error: unknown) => {
      console.warn('Unit location listener failed:', error);
      publish([], true);
    };
    const publicLocations = query(collectionGroup(db, 'unitLocations'), where('public', '==', true));
    const stopLocations = onSnapshot(publicLocations, snapshot => {
      publish(snapshot.docs.flatMap(record => {
        const location = mapUnitLocation(record.id, record.data());
        return location ? [location] : [];
      }));
    }, fail);
    return () => {
      active = false;
      expiry.stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', expiry.refresh);
      stopLocations();
    };
  }, [scope, uid]);

  // Never render another session's cached markers while effect cleanup runs.
  return state.scope === scope && scope ? state : { locations: [], error: false };
}
