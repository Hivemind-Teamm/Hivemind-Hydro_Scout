/**
 * Incident-only location thresholds.
 * Distances are meters; durations are milliseconds.
 */
export const INCIDENT_LOCATION_CONFIG = {
  maxIncidentDistanceM: 500,
  maxAccuracyM: 50,
  minMovementM: 10,
  minMovementWriteIntervalMs: 5_000,
  heartbeatIntervalMs: 30_000,
  staleTimeoutMs: 90_000,
  enableHighAccuracy: true,
};
