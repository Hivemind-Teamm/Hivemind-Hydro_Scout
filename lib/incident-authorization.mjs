/**
 * Server-side incident authorization policy.
 *
 * This is a decision helper, not an API endpoint.
 * It performs no database operations.
 *
 * IMPORTANT:
 * A client-provided barangay name, coordinates, or verification flag
 * must never be treated as proof of jurisdiction.
 */

export function canManageIncident({ role, jurisdictionVerified = false }) {
  if (role === "admin") {
    return true;
  }

  if (role === "sub_admin") {
    return jurisdictionVerified === true;
  }

  return false;
}
