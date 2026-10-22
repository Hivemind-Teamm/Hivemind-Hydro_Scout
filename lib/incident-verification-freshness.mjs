/**
 * Maximum age of server-verified incident assignments.
 *
 * This is separate from the 90-second expiry used by location readers.
 * Check synchronously at the point of GPS publication because browser
 * timers may be suspended while a tab is in the background.
 */
export const MAX_INCIDENT_VERIFICATION_AGE_MS = 15_000;

export function isIncidentVerificationFresh(
  verifiedAt,
  now = Date.now(),
) {
  if (
    typeof verifiedAt !== 'number' ||
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(now)
  ) {
    return false;
  }

  const age = now - verifiedAt;

  // Missing, future-dated, and expired verification all fail closed.
  return (
    age >= 0 &&
    age < MAX_INCIDENT_VERIFICATION_AGE_MS
  );
}