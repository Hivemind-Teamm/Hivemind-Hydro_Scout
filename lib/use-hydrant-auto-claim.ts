'use client';

import { useEffect, useRef } from 'react';
import { haversineM } from './haversine';
import {
  AUTO_CLAIM_NEAR_CHECK_MS,
  nearestTarget,
  planAutoClaim,
  type AutoClaimDwell,
  type AutoClaimHydrant,
} from './hydrant-auto-claim';
import { HydrantOccupancyRequestError, requestHydrantOccupancy } from './hydrant-occupancy-client';
import { readResponsePosition } from './use-response-location-sharing';

/** Retry spacing after a GPS failure or a request that never reached the server. */
const RETRY_MS = 30_000;

/**
 * Hydrants already tried per response. Survives effect restarts, and keeps a
 * hydrant the responder released (Undo) from being claimed again while they
 * are still standing at it.
 */
const attemptedByResponse = new Map<string, Set<string>>();

function attemptedFor(responseId: string) {
  let attempted = attemptedByResponse.get(responseId);
  if (!attempted) {
    attempted = new Set();
    attemptedByResponse.set(responseId, attempted);
  }
  return attempted;
}

/**
 * Claim a hydrant automatically when the responder reaches it (see
 * hydrant-auto-claim.ts for the rules).
 *
 * Runs a GPS check loop only while `enabled` and there are targets. Checks
 * are spaced by the distance to the nearest target (every 5 s close by, up
 * to every minute far away). Nothing is written until a claim is made, which
 * is one call to the same API as the Claim button.
 *
 * GPS readings use a 5 s maximum age, so they are shared with the response
 * location loop instead of waking the GPS twice.
 */
export function useHydrantAutoClaim<T extends AutoClaimHydrant>({ enabled, responseId, firePinId, targets, onClaimed }: {
  /** Location consent, a role that can claim, and a live occupancy snapshot. */
  enabled: boolean;
  responseId: string | null;
  firePinId: string | null;
  /** From selectAutoClaimTargets: empty once the responder holds a claim. */
  targets: readonly T[];
  onClaimed: (hydrant: T, firePinId: string) => void;
}) {
  const targetsRef = useRef(targets);
  const onClaimedRef = useRef(onClaimed);
  useEffect(() => {
    targetsRef.current = targets;
    onClaimedRef.current = onClaimed;
  });
  const hasTargets = targets.length > 0;

  useEffect(() => {
    if (!enabled || !responseId || !firePinId || !hasTargets) return;
    const attempted = attemptedFor(responseId);
    let stopped = false;
    let running = false;
    let dwell: AutoClaimDwell = null;
    let lastCheckAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => { void check(); }, ms);
    };

    const check = async () => {
      if (stopped || running) return;
      running = true;
      clearTimeout(timer);
      lastCheckAt = Date.now();
      let delay = RETRY_MS;
      try {
        const position = await readResponsePosition();
        if (stopped) return;
        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        const candidates = targetsRef.current.filter(hydrant => !attempted.has(hydrant.id));
        const nearest = nearestTarget(candidates.map(hydrant => ({
          id: hydrant.id,
          distanceM: haversineM(lat, lng, hydrant.lat, hydrant.lng),
        })));
        const plan = planAutoClaim(dwell, nearest, accuracy, Date.now());
        dwell = plan.dwell;
        delay = plan.nextCheckMs;
        if (!plan.claimId) return;

        const hydrant = candidates.find(item => item.id === plan.claimId);
        if (!hydrant) return;
        try {
          await requestHydrantOccupancy('claim', hydrant.id, firePinId);
          attempted.add(hydrant.id);
          if (!stopped) onClaimedRef.current(hydrant, firePinId);
        } catch (err) {
          // Taken, not allowed or invalid: don't ask again for this response.
          // Network or server faults may be retried on the next visit.
          const status = err instanceof HydrantOccupancyRequestError ? err.status : 0;
          if (status >= 400 && status < 500) attempted.add(hydrant.id);
          else delay = RETRY_MS;
          console.warn(`Automatic claim of ${hydrant.id} did not go through:`, err);
        }
      } catch (err) {
        console.warn('Hydrant auto-claim location check failed:', err);
      } finally {
        running = false;
        if (!stopped) schedule(delay);
      }
    };

    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckAt >= AUTO_CLAIM_NEAR_CHECK_MS) void check();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    void check();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [enabled, responseId, firePinId, hasTargets]);
}
