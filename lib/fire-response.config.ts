/**
 * fire-response.config.ts
 * Every number the fire-response formula uses. Changing a value here changes
 * the results without touching the formula; bump `version` whenever a value
 * changes. What each value means, and where it came from, is recorded in
 * docs/formula-spec.md.
 */

export interface HoseSize {
  /** Length of one section, in feet. */
  lengthFt: number;
  /** Sections of this size carried by one truck. */
  count: number;
}

export interface FireResponseConfig {
  /** Identifies this set of values; reported with every result. */
  version: string;
  /** Hose carried by one truck. */
  hosePerTruck: HoseSize[];
  /**
   * Longest stretch one pumper can push water through, in metres, when
   * pressure limits it to less than the hose it carries. `null` = no pressure
   * limit known, so the hose carried is the only limit.
   */
  maxPumpDistanceM: number | null;
  /**
   * Multiplier from straight-line distance to hose length. Used only when no
   * routing service answers.
   */
  layoutFactor: number | null;
  /** Hydrants within this straight-line distance of the fire are candidates. */
  hydrantSearchRadiusM: number;
}

export const FIRE_RESPONSE_CONFIG: FireResponseConfig = {
  version: '2026-10-12',
  hosePerTruck: [
    { lengthFt: 100, count: 10 },
    { lengthFt: 50, count: 10 },
  ],
  maxPumpDistanceM: null,
  layoutFactor: 1.3,
  hydrantSearchRadiusM: 500,
};
