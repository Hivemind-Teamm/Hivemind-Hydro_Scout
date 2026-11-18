/**
 * Automatic hydrant claiming for responders who reach a hydrant.
 *
 * While a responder shares their location and has an active fire response,
 * an operational or reduced-pressure hydrant is claimed for that response
 * once the responder is within AUTO_CLAIM_RADIUS_M of it. The claim goes
 * through the same server API as the Claim button, which checks the role,
 * the active response and that nobody else holds the hydrant.
 *
 * Two readings at least AUTO_CLAIM_DWELL_MS apart must both be within the
 * radius, so driving past a hydrant on the way somewhere else doesn't claim
 * it. Readings worse than AUTO_CLAIM_MAX_ACCURACY_M are not trusted.
 *
 * Pure and import-free so Node can unit-test it directly; callers pass in
 * distances computed with lib/haversine.ts.
 */

/** Claim when the responder is this close to a hydrant (metres). */
export const AUTO_CLAIM_RADIUS_M = 5;

/** Ignore readings whose reported GPS accuracy is worse than this (metres). */
export const AUTO_CLAIM_MAX_ACCURACY_M = 15;

/** Second reading inside the radius must come at least this long after the first. */
export const AUTO_CLAIM_DWELL_MS = 5_000;

/** Closest spacing between GPS checks, used near a hydrant. */
export const AUTO_CLAIM_NEAR_CHECK_MS = 5_000;

/** Widest spacing between GPS checks, used far from every hydrant. */
export const AUTO_CLAIM_FAR_CHECK_MS = 60_000;

/** Fastest approach speed assumed when spacing checks (90 km/h). */
export const AUTO_CLAIM_APPROACH_SPEED_MPS = 25;

/** Hydrant statuses that can be claimed automatically. */
export const AUTO_CLAIM_STATUSES: readonly string[] = ['operational', 'reduced'];

export type AutoClaimHydrant = { id: string; lat: number; lng: number; status: string };

export type AutoClaimOccupancy = { hydrantId: string; claimedByUid: string; responseId: string };

/**
 * Hydrants that may be claimed automatically for this response: operational
 * or reduced pressure, not already claimed, from the fire's hydrant list or
 * the hydrant being routed to. Empty when the responder already holds a
 * claim for this response (one automatic claim per response).
 */
export function selectAutoClaimTargets<T extends AutoClaimHydrant>({ candidates, routeTarget, claims, uid, responseId }: {
  candidates: readonly T[];
  routeTarget: T | null;
  claims: readonly AutoClaimOccupancy[];
  uid: string;
  responseId: string;
}): T[] {
  if (claims.some(claim => claim.claimedByUid === uid && claim.responseId === responseId)) return [];
  const claimed = new Set(claims.map(claim => claim.hydrantId));
  const seen = new Set<string>();
  const targets: T[] = [];
  for (const hydrant of routeTarget ? [routeTarget, ...candidates] : candidates) {
    if (seen.has(hydrant.id) || claimed.has(hydrant.id) || !AUTO_CLAIM_STATUSES.includes(hydrant.status)) continue;
    seen.add(hydrant.id);
    targets.push(hydrant);
  }
  return targets;
}

/** First reading inside the radius for a hydrant, or null. */
export type AutoClaimDwell = { hydrantId: string; since: number } | null;

export type AutoClaimPlan = {
  /** Hydrant to claim now, or null. */
  claimId: string | null;
  dwell: AutoClaimDwell;
  /** When to check the position again. */
  nextCheckMs: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Decide what to do with one GPS reading.
 *
 * @param nearest the closest target hydrant and its distance, or null when there are none
 * @param accuracyM the reading's reported accuracy, in metres
 */
export function planAutoClaim(
  dwell: AutoClaimDwell,
  nearest: { id: string; distanceM: number } | null,
  accuracyM: number,
  now: number,
): AutoClaimPlan {
  if (!nearest) return { claimId: null, dwell: null, nextCheckMs: AUTO_CLAIM_FAR_CHECK_MS };

  const inside = nearest.distanceM <= AUTO_CLAIM_RADIUS_M;
  if (!inside) {
    return {
      claimId: null,
      dwell: null,
      nextCheckMs: clamp(
        ((nearest.distanceM - AUTO_CLAIM_RADIUS_M) / AUTO_CLAIM_APPROACH_SPEED_MPS) * 1000,
        AUTO_CLAIM_NEAR_CHECK_MS,
        AUTO_CLAIM_FAR_CHECK_MS,
      ),
    };
  }

  // At the hydrant but the reading is too rough to trust: keep checking.
  if (!(accuracyM <= AUTO_CLAIM_MAX_ACCURACY_M)) {
    return { claimId: null, dwell, nextCheckMs: AUTO_CLAIM_NEAR_CHECK_MS };
  }

  if (dwell?.hydrantId === nearest.id) {
    if (now - dwell.since >= AUTO_CLAIM_DWELL_MS) {
      return { claimId: nearest.id, dwell: null, nextCheckMs: AUTO_CLAIM_NEAR_CHECK_MS };
    }
    return { claimId: null, dwell, nextCheckMs: Math.max(1_000, AUTO_CLAIM_DWELL_MS - (now - dwell.since)) };
  }

  return { claimId: null, dwell: { hydrantId: nearest.id, since: now }, nextCheckMs: AUTO_CLAIM_DWELL_MS };
}

/** Pick the closest of the given distances. */
export function nearestTarget(distances: readonly { id: string; distanceM: number }[]) {
  let best: { id: string; distanceM: number } | null = null;
  for (const item of distances) {
    if (Number.isFinite(item.distanceM) && (!best || item.distanceM < best.distanceM)) best = item;
  }
  return best;
}
