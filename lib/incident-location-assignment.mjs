/**
 * Proposed trusted incident-assignment contract.
 *
 * This helper is not proof of assignment by itself.
 * Callers must supply incident records obtained from a trusted server
 * or authoritative Firestore state, never client-provided flags.
 *
 * No Firebase operations occur here.
 */
export function isStationAssignedToActiveIncident(incident, stationId) {
  if (!incident || typeof incident !== 'object' || Array.isArray(incident)) {
    return false;
  }

  if (
    typeof stationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(stationId)
  ) {
    return false;
  }

  if (incident.status !== 'active') {
    return false;
  }

  if (!Array.isArray(incident.assignedStationIds)) {
    return false;
  }

  return incident.assignedStationIds.some(
    assigned => typeof assigned === 'string' && assigned === stationId
  );
}