export interface MapUnitLocation {
  id: string;
  stationId: string;
  incidentId?: string;
  stationName?: string;
  deviceId?: string;
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: number | null;
  isStale?: boolean;
}

/** Reject malformed records before passing coordinates to a map provider. */
export function mapUnitLocation(id: string, data: Record<string, unknown>): MapUnitLocation | null {
  const responderReport = typeof data.responseId === 'string' && data.responseId === id
    && /^[a-f0-9-]{36}$/.test(data.responseId) && data.public === true;
  const legacyReport = data.deviceId === undefined ? data.stationId === id
    : typeof data.deviceId === 'string' && /^[a-f0-9-]{36}$/.test(data.deviceId)
      && typeof data.updatedBy === 'string' && id === `${data.updatedBy}_${data.deviceId}`;
  if (typeof data.stationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.stationId)
    || (!responderReport && !legacyReport)
    || (responderReport && (typeof data.stationName !== 'string' || data.stationName.length < 1 || data.stationName.length > 120))
    || typeof data.lat !== 'number' || !Number.isFinite(data.lat) || Math.abs(data.lat) > 90
    || typeof data.lng !== 'number' || !Number.isFinite(data.lng) || Math.abs(data.lng) > 180
    || typeof data.accuracy !== 'number' || !Number.isFinite(data.accuracy)
    || data.accuracy < 0 || data.accuracy > 40_075_000) return null;
  const timestamp = data.updatedAt as { toMillis?: () => number } | undefined;
  const milliseconds = typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : null;
  return { id, stationId: data.stationId, ...(typeof data.stationName === 'string' ? { stationName: data.stationName } : {}),
    ...(typeof data.deviceId === 'string' ? { deviceId: data.deviceId } : {}), lat: data.lat, lng: data.lng, accuracy: data.accuracy,
    updatedAt: milliseconds !== null && Number.isFinite(milliseconds) ? milliseconds : null };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Validate an incident-linked device record before displaying it. */
export function mapIncidentUnitLocation(
  id: string,
  data: Record<string, unknown>,
): MapUnitLocation | null {
  const { stationId, updatedBy, incidentId, location, accuracy } = data;

  if (
    typeof stationId !== 'string' ||
    !SAFE_ID.test(stationId) ||
    typeof updatedBy !== 'string' ||
    !updatedBy ||
    typeof incidentId !== 'string' ||
    !SAFE_ID.test(incidentId)
  ) return null;

  const prefix = `${updatedBy}_`;
  if (!id.startsWith(prefix) || !UUID_PATTERN.test(id.slice(prefix.length))) {
    return null;
  }

  if (!location || typeof location !== 'object') return null;

  const coords = location as { latitude?: unknown; longitude?: unknown };
  const lat = coords.latitude;
  const lng = coords.longitude;

  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    typeof lng !== 'number' ||
    !Number.isFinite(lng) ||
    Math.abs(lng) > 180 ||
    typeof accuracy !== 'number' ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 50
  ) return null;

  const timestamp = data.updatedAt as
    | { toMillis?: () => number }
    | undefined;

  let updatedAt: number | null = null;
  try {
    const value = timestamp?.toMillis?.();
    if (typeof value === 'number' && Number.isFinite(value)) {
      updatedAt = value;
    }
  } catch {
    return null;
  }

  return { id, stationId, incidentId, lat, lng, accuracy, updatedAt };
}
