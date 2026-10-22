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
