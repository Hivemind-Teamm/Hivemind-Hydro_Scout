// Numbers behind the Operations Dashboard cards.
//
// BFP reference hydrants ("Temporarily unavailable") are still waiting for a
// field check, so they are counted on their own and left out of every
// operational percentage, compliance count, zone rating and trend point.

import type { Hydrant, HydrantRegisterEntry, HydrantStatus } from './hydrants';

const isChecked = (h: Hydrant) => h.status !== 'reference';

/* ── Status breakdown ─────────────────────────────────────────────────── */

export interface StatusBreakdown {
  operational: number;
  reduced: number;
  out: number;
  /** Field-checked hydrants: operational + reduced + out. */
  checked: number;
  /** Temporarily unavailable: BFP reference records awaiting a check. */
  pending: number;
  /** Share of checked hydrants that are operational; null when none are checked. */
  operationalPct: number | null;
}

export function statusBreakdown(hydrants: readonly Hydrant[]): StatusBreakdown {
  const result = { operational: 0, reduced: 0, out: 0, pending: 0 };
  for (const h of hydrants) {
    if (h.status === 'reference') result.pending++;
    else result[h.status]++;
  }
  const checked = result.operational + result.reduced + result.out;
  return { ...result, checked, operationalPct: checked ? Math.round((result.operational / checked) * 100) : null };
}

/* ── Hazard & compliance ──────────────────────────────────────────────── */

const NO_HAZARD = new Set(['', 'none', '-', '—']);

export const hasHazard = (h: Hydrant) => !NO_HAZARD.has(h.hazard.trim().toLowerCase());

export interface ComplianceStats {
  /** Field-checked hydrants (the BFP reference set has not been verified). */
  verified: number;
  obstructed: number;
  compliant: number;
  obstructedPct: number | null;
}

export function complianceStats(hydrants: readonly Hydrant[]): ComplianceStats {
  const checked = hydrants.filter(isChecked);
  const obstructed = checked.filter(hasHazard).length;
  return {
    verified: checked.length,
    obstructed,
    compliant: checked.length - obstructed,
    obstructedPct: checked.length ? Math.round((obstructed / checked.length) * 100) : null,
  };
}

/* ── Coverage by zone (barangay) ──────────────────────────────────────── */

export type ZoneRating = 'good' | 'moderate' | 'poor' | 'pending';

export interface ZoneStats {
  name: string;
  checked: number;
  operational: number;
  pending: number;
  rating: ZoneRating;
}

export function zoneStats(hydrants: readonly Hydrant[]): ZoneStats[] {
  const zones = new Map<string, { checked: number; operational: number; pending: number }>();
  for (const h of hydrants) {
    const name = h.barangay && h.barangay !== 'Unassigned' ? h.barangay : 'No barangay';
    const zone = zones.get(name) ?? { checked: 0, operational: 0, pending: 0 };
    if (h.status === 'reference') zone.pending++;
    else zone.checked++;
    if (h.status === 'operational') zone.operational++;
    zones.set(name, zone);
  }
  return [...zones.entries()]
    .map(([name, zone]) => {
      const share = zone.checked ? zone.operational / zone.checked : 0;
      const rating: ZoneRating = !zone.checked ? 'pending' : share >= 0.75 ? 'good' : share >= 0.5 ? 'moderate' : 'poor';
      return { name, ...zone, rating };
    })
    .sort((a, b) => b.checked - a.checked || b.pending - a.pending || a.name.localeCompare(b.name));
}

/* ── Condition trend ──────────────────────────────────────────────────── */

// Inverse of toOperationalStatus() in hydrants.ts, which writes these names
// into "Status set to …" and "Hydrant pinned as …" register entries.
const STATUS_BY_NAME: Record<string, HydrantStatus> = {
  'operational': 'operational',
  'reduced pressure': 'reduced',
  'out of service': 'out',
  'bfp reference': 'reference',
};

const STATUS_ACTION = /^(?:Status set to|Hydrant pinned as)\s+(.+)$/i;

/**
 * The status a register entry records, or null for entries that don't set
 * one (reports, validation, re-inspection flags). Their colours don't mean
 * a status, so only these actions are read.
 */
export function statusFromRegister(entry: HydrantRegisterEntry, hydrant: Hydrant): HydrantStatus | null {
  const match = STATUS_ACTION.exec(entry.action.trim());
  if (match) return STATUS_BY_NAME[match[1].trim().toLowerCase()] ?? null;
  // Synthesised for hydrants with no stored register: their status never changed.
  if (entry.action === 'Initial inspection') return hydrant.status;
  return null;
}

/** YYYY-MM-DD, or '' when the entry has no usable date. */
function dayOf(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Status on a day: the latest status entry on or before it, with undated
 * entries counting from the start. Null before the first one (not checked yet).
 */
function statusOn(hydrant: Hydrant, day: string): HydrantStatus | null {
  let latest: { day: string; status: HydrantStatus } | null = null;
  let recorded = false;
  for (const entry of hydrant.register) {
    const status = statusFromRegister(entry, hydrant);
    if (!status) continue;
    recorded = true;
    const entryDay = dayOf(entry.date);
    if (entryDay > day) continue;
    if (!latest || entryDay >= latest.day) latest = { day: entryDay, status };
  }
  // Never changed in the app (only reports or notes logged): it has had its
  // current status all along.
  if (!recorded) return hydrant.status;
  return latest?.status ?? null;
}

export interface TrendPoint {
  /** YYYY-MM-DD (UTC, like register dates). */
  day: string;
  /** Operational share of hydrants checked by then; null when there were none. */
  operationalPct: number | null;
  checked: number;
}

/**
 * Weekly operational % of field-checked hydrants, oldest first, ending today.
 * A hydrant counts in a week once a status was recorded for it by then;
 * the last point is today's live status breakdown.
 */
export function conditionTrend(hydrants: readonly Hydrant[], now = new Date(), weeks = 8): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10);
    if (i === 0) {
      const live = statusBreakdown(hydrants);
      points.push({ day, operationalPct: live.operationalPct, checked: live.checked });
      continue;
    }
    let checked = 0;
    let operational = 0;
    for (const h of hydrants) {
      const status = statusOn(h, day);
      if (!status || status === 'reference') continue;
      checked++;
      if (status === 'operational') operational++;
    }
    points.push({ day, operationalPct: checked ? Math.round((operational / checked) * 100) : null, checked });
  }
  return points;
}
