/**
 * fire-response.ts
 * Domain logic for the "pin a fire" feature: which hydrants can feed a fire at
 * a given point, and how much apparatus (hose + fire trucks) it takes to get
 * water from a hydrant to the fire.
 *
 * The supply-line calculation is deliberately parameter-driven. Until the
 * field data is known, every parameter below is `null` and the estimator
 * reports `status: 'pending'` — the UI renders that as "Pending data" instead
 * of a made-up number. Fill in SUPPLY_LINE_PARAMS (or swap the body of
 * `estimateSupplyLine` for a different model) and the fire panel picks the
 * results up with no UI changes.
 */

import { haversineM } from './haversine';
import type { Hydrant } from '../app/src/data/hydrants';

// ─── Search radius ────────────────────────────────────────────────────────────

/** Hydrants within this straight-line distance of the fire are candidates. */
export const FIRE_HYDRANT_RADIUS_M = 500;

// ─── Supply-line estimate ─────────────────────────────────────────────────────

export interface SupplyLineParams {
  /**
   * Length of one hose section, in metres. A 50 ft section is 15.24 m; a
   * 100 ft section is 30.48 m.
   */
  hoseSectionLengthM: number | null;
  /**
   * Longest hose lay a single fire truck can push water through while still
   * delivering usable pressure at the far end, in metres. Past this, another
   * truck has to relay-pump in between. Normally derived from pump pressure,
   * hose diameter, flow rate and friction loss.
   */
  maxPumpDistanceM: number | null;
  /**
   * Multiplier from straight-line distance to real hose-lay distance. Hose
   * follows streets and goes around buildings, so it is always ≥ 1
   * (1.3 is a common rule of thumb for urban grids).
   */
  layoutFactor: number | null;
}

/**
 * The numbers the supply-line model needs. `null` = not known yet — the panel
 * shows "Pending data" until all of them are set.
 */
export const SUPPLY_LINE_PARAMS: SupplyLineParams = {
  hoseSectionLengthM: null,
  maxPumpDistanceM: null,
  layoutFactor: null,
};

export type SupplyLineEstimate =
  | { status: 'pending'; missing: (keyof SupplyLineParams)[] }
  | {
      status: 'ready';
      /** Estimated length of hose actually laid, in metres. */
      hoseLengthM: number;
      /** Number of hose sections needed to cover that length. */
      hoseSections: number;
      /** Fire trucks needed: one at the hydrant plus any relay pumpers. */
      fireTrucks: number;
    };

/**
 * Estimate the apparatus needed to run a supply line `distanceM` metres
 * (straight-line) from a hydrant to the fire.
 *
 * Model (relay pumping): the hose lay is the straight-line distance scaled by
 * the layout factor; it is cut into whole hose sections; every
 * `maxPumpDistanceM` of hose needs its own truck pumping.
 */
export function estimateSupplyLine(
  distanceM: number,
  params: SupplyLineParams = SUPPLY_LINE_PARAMS,
): SupplyLineEstimate {
  const { hoseSectionLengthM, maxPumpDistanceM, layoutFactor } = params;
  if (hoseSectionLengthM === null || maxPumpDistanceM === null || layoutFactor === null) {
    const missing = (Object.keys(params) as (keyof SupplyLineParams)[]).filter((k) => params[k] === null);
    return { status: 'pending', missing };
  }

  const hoseLengthM = distanceM * layoutFactor;
  return {
    status: 'ready',
    hoseLengthM: Math.round(hoseLengthM),
    hoseSections: Math.max(1, Math.ceil(hoseLengthM / hoseSectionLengthM)),
    fireTrucks: Math.max(1, Math.ceil(hoseLengthM / maxPumpDistanceM)),
  };
}

// ─── Hydrants near a fire ─────────────────────────────────────────────────────

export interface FireHydrantCandidate {
  hydrant: Hydrant;
  /** Straight-line distance from the hydrant to the fire, in metres. */
  distanceM: number;
}

export interface FireHydrantRanking {
  /** Hydrants inside the radius, closest first (all statuses). */
  inRadius: FireHydrantCandidate[];
  /** Closest hydrant outside the radius — shown when none are inside. */
  nearestOutside: FireHydrantCandidate | null;
}

export function rankHydrantsNearFire(
  hydrants: Hydrant[],
  fire: { lat: number; lng: number },
  radiusM: number = FIRE_HYDRANT_RADIUS_M,
): FireHydrantRanking {
  const inRadius: FireHydrantCandidate[] = [];
  let nearestOutside: FireHydrantCandidate | null = null;

  for (const hydrant of hydrants) {
    const distanceM = haversineM(fire.lat, fire.lng, hydrant.lat, hydrant.lng);
    if (distanceM <= radiusM) {
      inRadius.push({ hydrant, distanceM });
    } else if (!nearestOutside || distanceM < nearestOutside.distanceM) {
      nearestOutside = { hydrant, distanceM };
    }
  }

  inRadius.sort((a, b) => a.distanceM - b.distanceM);
  return { inRadius, nearestOutside };
}

/**
 * The hydrant to draw the supply line from: the user's pick if it is still in
 * range, otherwise the closest operational one, otherwise the closest of any
 * status (a degraded hydrant beats none — the panel flags its status).
 */
export function pickSupplyHydrant(
  inRadius: FireHydrantCandidate[],
  preferredId: string | null,
): FireHydrantCandidate | null {
  if (preferredId) {
    const preferred = inRadius.find((c) => c.hydrant.id === preferredId);
    if (preferred) return preferred;
  }
  return inRadius.find((c) => c.hydrant.status === 'operational') ?? inRadius[0] ?? null;
}

// ─── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Closed ring of `[lng, lat]` points approximating a circle of `radiusM`
 * metres on the ground, for drawing the search radius as a GeoJSON polygon.
 * (A map "circle" layer is sized in pixels, not metres, so it can't be used.)
 */
export function circleRing(lat: number, lng: number, radiusM: number, steps = 72): [number, number][] {
  const R = 6371000;
  const δ = radiusM / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const ring: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const θ = (i / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return ring;
}
