import { INCIDENT_LOCATION_CONFIG as CONFIG } from "./incident-location-config";

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface ActiveIncidentLocation {
  id: string;
  lat: number;
  lng: number;
}

export interface LastLocationWrite {
  incidentId: string;
  fix: LocationFix;
  writtenAt: number;
}

export type LocationDecision =
  | { action: "write"; incidentId: string }
  | { action: "delete" }
  | { action: "skip"; reason: string };

export function distanceMeters(a: LocationFix, b: LocationFix): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDifference = radians(b.lat - a.lat);
  const lngDifference = radians(b.lng - a.lng);
  const latitude1 = radians(a.lat);
  const latitude2 = radians(b.lat);

  const value =
    Math.sin(latDifference / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) *
    Math.sin(lngDifference / 2) ** 2;

  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(value)));
}

export function decideIncidentLocationAction(
  fix: LocationFix,
  incidents: ActiveIncidentLocation[],
  lastWrite: LastLocationWrite | null,
  now: number,
): LocationDecision {
  // Incident lifecycle cleanup must not depend on GPS accuracy.
  if (incidents.length === 0) {
    return { action: "delete" };
  }

  if (
    !Number.isFinite(now) ||
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    !Number.isFinite(fix.accuracy) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180 ||
    fix.accuracy < 0 ||
    fix.accuracy > CONFIG.maxAccuracyM
  ) {
    return { action: "skip", reason: "inaccurate-or-invalid-fix" };
  }

  const nearby = incidents
    .filter(incident =>
      incident.id.length > 0 &&
      Number.isFinite(incident.lat) &&
      Number.isFinite(incident.lng) &&
      Math.abs(incident.lat) <= 90 &&
      Math.abs(incident.lng) <= 180
    )
    .map(incident => ({
      incident,
      distance: distanceMeters(fix, {
        lat: incident.lat,
        lng: incident.lng,
        accuracy: 0,
      }),
    }))
    .filter(item => item.distance <= CONFIG.maxIncidentDistanceM)
    .sort((a, b) => a.distance - b.distance);

  if (nearby.length === 0) {
    return { action: "delete" };
  }

  const incidentId = nearby[0].incident.id;

  if (!lastWrite || lastWrite.incidentId !== incidentId) {
    return { action: "write", incidentId };
  }

  const elapsed = now - lastWrite.writtenAt;

  if (elapsed < 0 || !Number.isFinite(elapsed)) {
    return { action: "skip", reason: "invalid-elapsed-time" };
  }

  const moved = distanceMeters(fix, lastWrite.fix);

  if (
    elapsed >= CONFIG.heartbeatIntervalMs ||
    (
      elapsed >= CONFIG.minMovementWriteIntervalMs &&
      moved >= CONFIG.minMovementM
    )
  ) {
    return { action: "write", incidentId };
  }

  return { action: "skip", reason: "throttled" };
}
