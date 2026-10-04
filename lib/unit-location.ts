/** Temporary contract until F1 lands: station accounts are explicitly marked. */
export interface StationProfile {
  accountType?: unknown;
  stationId?: unknown;
}

export interface UnitPosition {
  stationId: string;
  updatedBy: string;
  lat: number;
  lng: number;
  accuracy: number;
}

export type LocationWriteResult = "written" | "skipped" | "cancelled" | "unavailable" | "failed";

interface LocationDependencies {
  readProfile: () => Promise<StationProfile | undefined>;
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined;
  isCurrentSession: () => boolean;
  writePosition: (position: UnitPosition) => Promise<void>;
}

export function stationIdForLocation(profile: StationProfile | undefined): string | null {
  if (profile?.accountType !== "station") return null;
  const id = profile.stationId;
  // Never substitute the legacy station display name or the user's UID.
  return typeof id === "string" && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id)
    ? id : null;
}

/** Capture one fresh position; failure must not interrupt the signed-in session. */
export async function writeLoginLocation(
  uid: string,
  dependencies: LocationDependencies,
): Promise<LocationWriteResult> {
  try {
    const stationId = stationIdForLocation(await dependencies.readProfile());
    if (!stationId) return "skipped";
    if (!dependencies.isCurrentSession()) return "cancelled";
    const geolocation = dependencies.geolocation;
    if (!geolocation) return "unavailable";

    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      // Also bound time spent waiting on a browser permission prompt.
      const timer = setTimeout(() => resolve(null), 15_000);
      const finish = (value: GeolocationPosition | null) => {
        clearTimeout(timer);
        resolve(value);
      };
      try {
        geolocation.getCurrentPosition(finish, () => finish(null), {
          enableHighAccuracy: true, maximumAge: 0, timeout: 10_000,
        });
      } catch {
        finish(null);
      }
    });
    if (!dependencies.isCurrentSession()) return "cancelled";
    if (!position) return "unavailable";
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90
      || !Number.isFinite(lng) || lng < -180 || lng > 180
      || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 40_075_000) {
      return "unavailable";
    }
    await dependencies.writePosition({ stationId, updatedBy: uid, lat, lng, accuracy });
    return "written";
  } catch {
    return "failed";
  }
}

export const UNIT_LOCATION_REPORT_INTERVAL_MS = 3 * 60_000;

/** One publisher per session; concurrent resume events never overlap GPS requests. */
export function startStationLocationReporting(
  uid: string,
  dependencies: LocationDependencies & {
    isActive: () => boolean;
    onResult?: (result: LocationWriteResult) => void;
  },
  intervalMs = UNIT_LOCATION_REPORT_INTERVAL_MS,
) {
  let stopped = false;
  let inFlight = false;
  let lastStarted = -Infinity;
  const isCurrent = () => !stopped && dependencies.isCurrentSession() && dependencies.isActive();
  const refresh = async () => {
    // Focus and visibility events commonly arrive together.
    if (inFlight || !isCurrent() || Date.now() - lastStarted < 10_000) return;
    inFlight = true;
    lastStarted = Date.now();
    try {
      const result = await writeLoginLocation(uid, { ...dependencies, isCurrentSession: isCurrent });
      if (!stopped) dependencies.onResult?.(result);
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => { void refresh(); }, intervalMs);
  void refresh();
  return { refresh, stop() { stopped = true; clearInterval(timer); } };
}
