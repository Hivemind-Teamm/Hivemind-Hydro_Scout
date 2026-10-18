/**
 * supply-layout.ts
 * Where the pieces of a supply line go when it is drawn: the hose stages and
 * the fire truck at each end of them. Presentation only; the counts come
 * from the formula in supply-line.ts and are not changed here.
 */

import type { SupplyLineEstimate } from './supply-line';

type ReadyEstimate = Extract<SupplyLineEstimate, { status: 'ready' }>;

export interface SupplyTruck {
  /** Pumper at the hydrant, relay pumper between stages, or engine at the fire. */
  role: 'pumper' | 'relay' | 'engine';
  /** `[lng, lat]` */
  at: [number, number];
  /** Trucks drawn as this one: a relay right by the fire is drawn with the engine. */
  count: number;
}

/**
 * A relay pumper this close to the fire (along the hose) would hide under the
 * fire pin, so it is counted on the engine's badge instead.
 */
export const MERGE_NEAR_FIRE_M = 50;

export interface SupplyLineLayout {
  /** Every truck in the line, hydrant end first. Empty while the counts are pending. */
  trucks: SupplyTruck[];
  /** `[lng, lat]` for the distance label: halfway along the first stage, so it never sits on a truck. */
  labelAt: [number, number];
}

/**
 * Length of each hose stage, hydrant end first, in whole metres. Every stage
 * but the last is one full stage; together they add up to `hoseLengthM`.
 */
export function supplyStages({ hoseLengthM, stageLengthM, trucks }: Pick<ReadyEstimate, 'hoseLengthM' | 'stageLengthM' | 'trucks'>): number[] {
  const count = trucks.pumperAtHydrant + trucks.relayPumpers;
  // Rounding where each stage ends, not each stage, keeps the sum exact.
  // Rounding down keeps the last stage longer than zero: the formula only
  // adds a stage when the hose runs past the previous one.
  const ends = Array.from({ length: count }, (_, i) =>
    i === count - 1 ? hoseLengthM : Math.min(hoseLengthM, Math.floor((i + 1) * stageLengthM)));
  return ends.map((end, i) => end - (i > 0 ? ends[i - 1] : 0));
}

/**
 * The `[lng, lat]` point `fraction` (0–1) of the way along a path by distance.
 * Distances are planar with longitude scaled by latitude; across the few
 * kilometres of a supply line that matches great-circle shares closely.
 */
export function pointAlongPath(path: [number, number][], fraction: number): [number, number] {
  const kx = Math.cos((path[0][1] * Math.PI) / 180);
  const lengths = path.slice(1).map(([lng, lat], i) => Math.hypot((lng - path[i][0]) * kx, lat - path[i][1]));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * Math.min(1, Math.max(0, fraction));

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

/**
 * Lays the trucks of `estimate` out along `path` (hydrant first, fire last):
 * the pumper at the hydrant, a relay pumper where each full stage ends, and
 * the engine at the fire. Stage ends are placed by their share of the hose
 * length, so they also land in proportion on a straight stand-in line.
 */
export function layoutSupplyLine(path: [number, number][], estimate: ReadyEstimate | null): SupplyLineLayout {
  const hydrant = path[0];
  const fire = path[path.length - 1];
  if (!estimate || estimate.hoseLengthM <= 0) {
    const trucks: SupplyTruck[] = estimate
      ? [{ role: 'pumper', at: hydrant, count: 1 }, { role: 'engine', at: fire, count: 1 }]
      : [];
    return { trucks, labelAt: pointAlongPath(path, 0.5) };
  }

  const stages = supplyStages(estimate);
  const share = (meters: number) => meters / estimate.hoseLengthM;
  let laidM = 0;
  const relays = stages.slice(0, -1).map((stageM): SupplyTruck => {
    laidM += stageM;
    return { role: 'relay', at: pointAlongPath(path, share(laidM)), count: 1 };
  });
  // Only the last relay can be this close: earlier ones are a full stage apart.
  const nearFire = stages.length > 1 && stages[stages.length - 1] < MERGE_NEAR_FIRE_M ? relays.pop() : undefined;
  return {
    trucks: [
      { role: 'pumper', at: hydrant, count: 1 },
      ...relays,
      { role: 'engine', at: fire, count: nearFire ? 2 : 1 },
    ],
    labelAt: pointAlongPath(path, share(stages[0] / 2)),
  };
}
