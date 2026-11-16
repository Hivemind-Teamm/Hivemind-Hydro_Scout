'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from './auth-context';
import { db } from './firebase';

export interface HydrantOccupancy {
  hydrantId: string;
  firePinId: string;
  responseId: string;
  claimedByUid: string;
}

interface OccupancyState {
  uid: string | null;
  claims: HydrantOccupancy[];
  ready: boolean;
  error: string | null;
}

const EMPTY_CLAIMS: HydrantOccupancy[] = [];

export function useHydrantOccupancy() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [state, setState] = useState<OccupancyState>({
    uid: null, claims: EMPTY_CLAIMS, ready: false, error: null,
  });

  useEffect(() => {
    if (!uid) return;
    let active = true;
    const unsubscribe = onSnapshot(
      collection(db, 'hydrantOccupancy'),
      { includeMetadataChanges: true },
      snapshot => {
        if (!active) return;
        const claims: HydrantOccupancy[] = snapshot.docs.flatMap(record => {
          const data = record.data();
          if (
            typeof data.firePinId !== 'string' ||
            typeof data.responseId !== 'string' ||
            typeof data.claimedByUid !== 'string'
          ) return [];
          return [{
            hydrantId: record.id,
            firePinId: data.firePinId,
            responseId: data.responseId,
            claimedByUid: data.claimedByUid,
          }];
        });
        // Cached snapshots are useful for display but cannot be trusted for
        // claim availability. Wait for a server-confirmed snapshot.
        const ready = !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites;
        setState({ uid, claims, ready, error: null });
      },
      () => {
        if (!active) return;
        setState({
          uid, claims: EMPTY_CLAIMS, ready: false,
          error: 'Live hydrant occupancy is unavailable. Check your connection and Firestore permissions.',
        });
      },
    );
    return () => { active = false; unsubscribe(); };
  }, [uid]);

  const current = !!uid && state.uid === uid;
  const claims = current ? state.claims : EMPTY_CLAIMS;
  const claimsByHydrantId = useMemo(
    () => new Map(claims.map(claim => [claim.hydrantId, claim])),
    [claims],
  );

  return {
    claims,
    claimsByHydrantId,
    ready: current && state.ready,
    loading: !!uid && (!current || (!state.ready && !state.error)),
    error: current ? state.error : null,
  };
}
