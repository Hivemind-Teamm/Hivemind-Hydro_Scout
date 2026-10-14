/**
 * fire-response.ts
 * Domain logic for the "pin a fire" feature: which hydrants can feed a fire at
 * a given point, and which one the supply line is drawn from.
 *
 * How much hose and how many fire trucks that line takes is worked out in
 * supply-line.ts, from the values in fire-response.config.ts.
 */

import { FIRE_RESPONSE_CONFIG } from './fire-response.config';
import { haversineM } from './haversine';
import type { Hydrant } from '../app/src/data/hydrants';

// ─── Search radius ────────────────────────────────────────────────────────────

/** Hydrants within this straight-line distance of the fire are candidates. */
export const FIRE_HYDRANT_RADIUS_M = FIRE_RESPONSE_CONFIG.hydrantSearchRadiusM;

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

/**
 * The `[lng, lat]` point halfway along a path by distance, for placing a
 * label on a line that bends.
 */
export function pathMidpoint(path: [number, number][]): [number, number] {
  const lengths = path.slice(1).map(([lng, lat], i) => haversineM(path[i][1], path[i][0], lat, lng));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;

  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] > 0 ? remaining / lengths[i] : 0;
      return [
        path[i][0] + (path[i + 1][0] - path[i][0]) * t,
        path[i][1] + (path[i + 1][1] - path[i][1]) * t,
      ];
    }
    remaining -= lengths[i];
  }
  return path[path.length - 1];
}
