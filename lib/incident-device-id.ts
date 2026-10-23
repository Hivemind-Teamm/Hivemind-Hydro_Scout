/**
 * Persistent device identity for incident location reporting.
 * Never fall back to an unstable ID if localStorage is unavailable.
 */
const DEVICE_ID_KEY = 'hydroscout-incident-device-id';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read an existing incident device ID without creating one.
 *
 * Used during logout so users who have never shared their
 * incident location do not acquire a new tracking identity.
 */
export function getExistingIncidentDeviceId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);

    return existing && UUID_PATTERN.test(existing)
      ? existing
      : null;
  } catch {
    return null;
  }
}

export function getIncidentDeviceId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);

    if (existing && UUID_PATTERN.test(existing)) {
      return existing;
    }

    if (typeof window.crypto?.randomUUID !== 'function') {
      return null;
    }

    const created = window.crypto.randomUUID();

    if (!UUID_PATTERN.test(created)) return null;

    window.localStorage.setItem(DEVICE_ID_KEY, created);

    return window.localStorage.getItem(DEVICE_ID_KEY) === created
      ? created
      : null;
  } catch {
    return null;
  }
}
