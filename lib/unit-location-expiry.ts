import type { MapUnitLocation } from './map-unit-location';

export const DEFAULT_UNIT_LOCATION_TIMEOUT_MS = 15 * 60_000;
export const DEFAULT_UNIT_LOCATION_STALE_AFTER_MS = 6 * 60_000;

export function locationTimeoutMs(minutes: string | undefined): number {
  const value = Number(minutes);
  return Number.isFinite(value) && value > 0 && value <= 24 * 60
    ? value * 60_000 : DEFAULT_UNIT_LOCATION_TIMEOUT_MS;
}

/** Missing timestamps cannot establish freshness; expiry is inclusive. */
export function freshUnitLocations(
  locations: MapUnitLocation[],
  now: number,
  timeoutMs: number,
  staleAfterMs = DEFAULT_UNIT_LOCATION_STALE_AFTER_MS,
) {
  return locations
    .filter(location => location.updatedAt !== null
      && Number.isFinite(location.updatedAt)
      && location.updatedAt + timeoutMs > now)
    .map(location => ({
      ...location,
      isStale: now - location.updatedAt! >= staleAfterMs,
    }));
}

/** Reschedule at the next report's expiry, independently of Firestore updates. */
export function watchUnitLocationExpiry(
  onChange: (locations: MapUnitLocation[]) => void,
  timeoutMs = DEFAULT_UNIT_LOCATION_TIMEOUT_MS,
  staleAfterMs = DEFAULT_UNIT_LOCATION_STALE_AFTER_MS,
) {
  let locations: MapUnitLocation[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const refresh = () => {
    if (stopped) return;
    clearTimeout(timer);
    const now = Date.now();
    const visible = freshUnitLocations(locations, now, timeoutMs, staleAfterMs);
    onChange(visible);
    if (visible.length) {
      const nextTransition = Math.min(...visible.map(location => (
        location.isStale
          ? location.updatedAt! + timeoutMs
          : Math.min(location.updatedAt! + staleAfterMs, location.updatedAt! + timeoutMs)
      )));
      // Cap the browser timeout even if a device clock trails server time.
      timer = setTimeout(refresh, Math.min(2_147_483_647, Math.max(1, nextTransition - now)));
    }
  };
  return {
    update(next: MapUnitLocation[]) { locations = next; refresh(); },
    refresh,
    stop() { stopped = true; clearTimeout(timer); },
  };
}
