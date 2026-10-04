export interface MapUnitLocation {
  stationId: string;
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: number | null;
}

/** Reject malformed records before passing coordinates to a map provider. */
export function mapUnitLocation(id: string, data: Record<string, unknown>): MapUnitLocation | null {
  if (data.stationId !== id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)
    || typeof data.lat !== 'number' || !Number.isFinite(data.lat) || Math.abs(data.lat) > 90
    || typeof data.lng !== 'number' || !Number.isFinite(data.lng) || Math.abs(data.lng) > 180
    || typeof data.accuracy !== 'number' || !Number.isFinite(data.accuracy)
    || data.accuracy < 0 || data.accuracy > 40_075_000) return null;
  const timestamp = data.updatedAt as { toMillis?: () => number } | undefined;
  const milliseconds = typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : null;
  return { stationId: id, lat: data.lat, lng: data.lng, accuracy: data.accuracy,
    updatedAt: milliseconds !== null && Number.isFinite(milliseconds) ? milliseconds : null };
}
