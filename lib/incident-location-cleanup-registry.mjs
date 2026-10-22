/**
 * Coordinates incident-location cleanup with authenticated logout.
 *
 * This module does not import Firebase, start GPS, or publish locations.
 * A tracking session registers its own stopAndSettle callback.
 */

export function createIncidentLocationCleanupRegistry() {
  let registration = null;

  function validUid(uid) {
    return (
      typeof uid === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(uid)
    );
  }

  return {
    register(uid, cleanup) {
      if (!validUid(uid) || typeof cleanup !== 'function') {
        throw new Error('invalid-cleanup-registration');
      }

      // Never replace an active cleanup registration silently.
      if (registration !== null) {
        throw new Error('cleanup-already-registered');
      }

      const entry = { uid, cleanup };
      registration = entry;

      // An obsolete component must not unregister a newer session.
      return () => {
        if (registration === entry) {
          registration = null;
        }
      };
    },

    async cleanup(uid) {
      if (!validUid(uid)) {
        throw new Error('invalid-cleanup-identity');
      }

      if (registration === null || registration.uid !== uid) {
        throw new Error('incident-cleanup-unavailable');
      }

      // Propagate failures. Logout must not interpret a failed
      // deletion as successful cleanup.
      await registration.cleanup();
    },

    get registeredUid() {
      return registration?.uid ?? null;
    },
  };
}

export const incidentLocationCleanupRegistry =
  createIncidentLocationCleanupRegistry();