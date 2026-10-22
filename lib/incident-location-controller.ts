import {
  decideIncidentLocationAction,
  type ActiveIncidentLocation,
  type LastLocationWrite,
  type LocationFix,
} from './incident-location-algorithm';
import { INCIDENT_LOCATION_CONFIG } from './incident-location-config';

export interface IncidentLocationDependencies {
  geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'>;
  writeLocation: (incidentId: string, fix: LocationFix) => Promise<void>;
  deleteLocation: () => Promise<void>;
  onError?: (reason: string) => void;
  now?: () => number;
}

export function createIncidentLocationController(
  dependencies: IncidentLocationDependencies,
) {
  let active = false;
  let watchId: number | null = null;
  let generation = 0;
  let incidents: ActiveIncidentLocation[] = [];
  let lastWrite: LastLocationWrite | null = null;
  let lastFix: LocationFix | null = null;
  let lastFixReceivedAt: number | null = null;
  let lastFixAcquiredAt: number | null = null;
  const maxCachedFixAgeMs = 30_000;
  let cleanupPending = false;
  let queue = Promise.resolve();

  const now = dependencies.now ?? Date.now;

  const enqueue = (operation: () => Promise<void>) => {
    queue = queue.then(operation).catch(() => {
      dependencies.onError?.('location-write-failed');
    });
  };

  const removeLocation = () => {
    cleanupPending = true;

    enqueue(async () => {
      // Always execute queued cleanup after earlier writes,
      // including when tracking has already restarted.
      if (!cleanupPending) return;

      await dependencies.deleteLocation();

      // Clear pending cleanup only after deletion succeeds.
      cleanupPending = false;
      lastWrite = null;
    });
  };

  const processFix = (
    fix: LocationFix,
    token: number,
    acquiredAt: number,
  ) => {
    if (!active || token !== generation) return;

    lastFix = fix;
    lastFixReceivedAt = now();
    lastFixAcquiredAt = acquiredAt;

    enqueue(async () => {
      if (!active || token !== generation) return;

      // Do not republish a device location while old cleanup is pending.
      if (cleanupPending) return;

      const timestamp = now();

      // Queued GPS fixes may become stale while an earlier upload runs.
      if (
        !Number.isFinite(acquiredAt) ||
        !Number.isFinite(timestamp) ||
        acquiredAt > timestamp ||
        timestamp - acquiredAt > maxCachedFixAgeMs
      ) {
        dependencies.onError?.('gps-position-stale');
        return;
      }
      const decision = decideIncidentLocationAction(
        fix,
        incidents,
        lastWrite,
        timestamp,
      );

      if (decision.action === 'delete') {
        await dependencies.deleteLocation();
        lastWrite = null;
        return;
      }

      if (decision.action !== 'write') return;

      await dependencies.writeLocation(decision.incidentId, fix);

      if (!active || token !== generation) return;

      lastWrite = {
        incidentId: decision.incidentId,
        fix,
        // Throttling starts when the upload succeeds, not when it begins.
        writtenAt: now(),
      };
    });
  };

  const stopWatch = () => {
    if (watchId !== null) {
      dependencies.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };

  return {
    start(initialIncidents: ActiveIncidentLocation[]) {
      if (active) return;

      incidents = [...initialIncidents];

      if (!incidents.length) return;

      active = true;
      const token = ++generation;

      // Retry cleanup before processing fixes for this new session.
      // Queue ordering prevents a new write from overtaking deletion.
      if (cleanupPending) removeLocation();

      try {
        watchId = dependencies.geolocation.watchPosition(
          position => {
            if (!active || token !== generation) return;

            // Require a valid, fresh browser GPS acquisition timestamp.
            const positionTime = position.timestamp;
            const currentTime = now();

            if (
              typeof positionTime !== 'number' ||
              !Number.isFinite(positionTime) ||
              !Number.isFinite(currentTime) ||
              positionTime > currentTime ||
              currentTime - positionTime > maxCachedFixAgeMs
            ) {
              dependencies.onError?.('gps-position-stale');
              return;
            }

            const fix: LocationFix = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
            };

            if (
              !Number.isFinite(fix.accuracy) ||
              fix.accuracy < 0 ||
              fix.accuracy > INCIDENT_LOCATION_CONFIG.maxAccuracyM
            ) {
              dependencies.onError?.('gps-accuracy-too-low');
            }

            // Algorithm 4 still decides whether to write, skip, or delete.
            processFix(fix, token, positionTime);
          },
          error => {
            // Ignore callbacks from an obsolete GPS session.
            if (!active || token !== generation) return;

            if (error.code === 1) {
              // PERMISSION_DENIED: stop GPS and remove published location.
              active = false;
              ++generation;
              stopWatch();
              lastFix = null;
              lastFixReceivedAt = null;
      lastFixAcquiredAt = null;
              removeLocation();
              dependencies.onError?.('geolocation-permission-denied');
              return;
            }

            // TIMEOUT and POSITION_UNAVAILABLE can be temporary.
            dependencies.onError?.('geolocation-unavailable');
          },
          {
            enableHighAccuracy: INCIDENT_LOCATION_CONFIG.enableHighAccuracy,
            maximumAge: 0,
            timeout: 10_000,
          },
        );
      } catch {
        active = false;
        ++generation;
        dependencies.onError?.('geolocation-unavailable');
      }
    },

    updateIncidents(nextIncidents: ActiveIncidentLocation[]) {
      incidents = [...nextIncidents];

      if (!incidents.length) {
        this.stop();
        return;
      }

      if (!active) {
        this.start(incidents);
        return;
      }

      const currentTime = now();

      if (
        lastFix !== null &&
        lastFixReceivedAt !== null &&
        Number.isFinite(currentTime) &&
        currentTime >= lastFixReceivedAt &&
        currentTime - lastFixReceivedAt <= maxCachedFixAgeMs
      ) {
        // A reused fix was received recently, but must also retain
        // its original GPS acquisition timestamp.
        processFix(lastFix, generation, lastFixAcquiredAt ?? NaN);
      }
    },

    stop() {
      if (!active && watchId === null) {
        if (cleanupPending) removeLocation();
        return;
      }

      active = false;
      ++generation;
      stopWatch();
      lastFix = null;
      lastFixReceivedAt = null;
      lastFixAcquiredAt = null;
      removeLocation();
    },

    async settled() {
      await queue;
    },

    /**
     * Stop GPS and wait for all outstanding writes and cleanup.
     * A failed deletion must not be mistaken for successful shutdown.
     */
    async stopAndSettle() {
      this.stop();
      await queue;

      if (cleanupPending) {
        throw new Error('incident-location-cleanup-failed');
      }
    },

    get active() {
      return active;
    },
  };
}
