/**
 * supply-line.ts
 * The fire-response formula: how much hose and how many fire trucks it takes
 * to run one supply line from a hydrant to a fire.
 *
 * The steps, the counting rule and the result shape are frozen in
 * docs/formula-spec.md — change the spec before changing this file. The
 * spec's worked examples are the tests in test/supply-line.test.mjs.
 */

import type { FireResponseConfig } from './fire-response.config';

export type RouteSource = 'streets' | 'mapbox' | 'straight-line';

export interface SupplyLineInput {
  /** Straight-line distance from the hydrant to the fire, in metres. */
  straightLineM: number;
  /**
   * Routed hose distance, in metres. `null` while a route is still being
   * fetched or when no routing service answered; the straight-line fallback
   * is used then.
   */
  route: { meters: number; source: Exclude<RouteSource, 'straight-line'> } | null;
}

export type SupplyLineEstimate =
  | { status: 'pending'; missing: string[] }
  | {
      status: 'ready';
      /** Distance the hose must cover, in whole metres. */
      hoseLengthM: number;
      /** Total hose sections used. */
      hoseSections: number;
      /** Total fire trucks: the three counts in `trucks` added up. */
      fireTrucks: number;
      trucks: {
        engineAtFire: number;
        pumperAtHydrant: number;
        relayPumpers: number;
      };
      hose: {
        /** Sections used per hose size, longest first. */
        sections: { lengthFt: number; count: number }[];
        /** Combined length of the sections used, in whole metres. */
        laidLengthM: number;
      };
      /** Longest stretch one pumper covers, in metres. */
      stageLengthM: number;
      distance: {
        /** Where `hoseLengthM` came from. `straight-line` is an estimate. */
        source: RouteSource;
        straightLineM: number;
      };
      configVersion: string;
    };

const CM_PER_FT = 30.48;

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function estimateSupplyLine(
  input: SupplyLineInput,
  config: FireResponseConfig,
): SupplyLineEstimate {
  const { hosePerTruck, maxPumpDistanceM, layoutFactor } = config;
  const straightLineM = isPositive(input.straightLineM) ? input.straightLineM : 0;

  // Step 1: hose length — the routed distance, else the straight-line fallback.
  const routed = input.route !== null && Number.isFinite(input.route.meters) && input.route.meters >= 0
    ? input.route : null;
  const lay: { meters: number; source: RouteSource } | null = routed
    ?? (isPositive(layoutFactor) ? { meters: straightLineM * layoutFactor, source: 'straight-line' } : null);

  const missing: string[] = [];
  if (!hosePerTruck.length
    || hosePerTruck.some((size) => !isPositive(size.lengthFt) || !Number.isInteger(size.count) || size.count <= 0)) {
    missing.push('hosePerTruck');
  }
  if (maxPumpDistanceM !== null && !isPositive(maxPumpDistanceM)) missing.push('maxPumpDistanceM');
  if (!lay) missing.push('layoutFactor');
  if (missing.length || !lay) return { status: 'pending', missing };

  // Whole centimetres from here on: 50 ft is exactly 1524 cm, so section and
  // stage boundaries never drift with floating-point error.
  const hoseLengthM = Math.round(lay.meters);
  const neededCm = hoseLengthM * 100;
  const sizes = [...hosePerTruck]
    .sort((a, b) => b.lengthFt - a.lengthFt)
    .map((size) => ({ lengthFt: size.lengthFt, cm: Math.round(size.lengthFt * CM_PER_FT), perTruck: size.count }));
  const perTruckCm = sizes.reduce((sum, size) => sum + size.cm * size.perTruck, 0);

  // Step 2: stage length — a pumper cannot push water farther than the hose
  // it carries, and a pressure limit can shorten that.
  const stageCm = maxPumpDistanceM === null
    ? perTruckCm
    : Math.max(1, Math.min(perTruckCm, Math.round(maxPumpDistanceM * 100)));

  // Step 3: one pumper at the hydrant always, one more per extra stage, plus
  // the engine at the fire.
  const supplyPumpers = Math.max(1, Math.ceil(neededCm / stageCm));

  // Step 4: hose comes from the supply pumpers, longest sections first. The
  // engine at the fire keeps its own hose for attack lines.
  let remainingCm = neededCm;
  const used = sizes.map((size) => {
    const available = size.perTruck * supplyPumpers;
    const count = Math.min(available, Math.floor(remainingCm / size.cm));
    remainingCm -= count * size.cm;
    return { ...size, available, count };
  });
  // What is left is shorter than every size still in stock, so one more of
  // the shortest covers it. A zero-length line still needs one section.
  if (remainingCm > 0 || neededCm === 0) {
    const shortest = [...used].reverse().find((size) => size.count < size.available);
    if (shortest) shortest.count += 1;
  }

  return {
    status: 'ready',
    hoseLengthM,
    hoseSections: used.reduce((sum, size) => sum + size.count, 0),
    fireTrucks: 1 + supplyPumpers,
    trucks: { engineAtFire: 1, pumperAtHydrant: 1, relayPumpers: supplyPumpers - 1 },
    hose: {
      sections: used.map(({ lengthFt, count }) => ({ lengthFt, count })),
      laidLengthM: Math.round(used.reduce((sum, size) => sum + size.count * size.cm, 0) / 100),
    },
    stageLengthM: Math.round(stageCm / 10) / 10,
    distance: { source: lay.source, straightLineM: Math.round(straightLineM) },
    configVersion: config.version,
  };
}
