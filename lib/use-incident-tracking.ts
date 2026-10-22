'use client';

import { useEffect, useRef, useState } from 'react';
import { auth, db } from './firebase';
import { useAuth } from './auth-context';
import { useAssignedIncidents } from './use-assigned-incidents';
import { useIncidentWakeLock } from './use-incident-wake-lock';
import { createIncidentLocationController } from './incident-location-controller';
import { createIncidentLocationWriter } from './incident-location-writer';
import { incidentLocationCleanupRegistry } from './incident-location-cleanup-registry.mjs';
import { isIncidentVerificationFresh } from './incident-verification-freshness.mjs';

type Controller = ReturnType<typeof createIncidentLocationController>;

interface TrackingSession {
  uid: string;
  stationId: string;
  controller: Controller;
  unregister: () => void;
  shutdown: Promise<void> | null;
  logoutRequested: boolean;
}

interface TrackingStatus {
  watching: boolean;
  sharing: boolean;
  error: string | null;
}

export function useIncidentTracking(enabled = true) {
  const { user, role, trustedStationId } = useAuth();
  const uid = user?.uid ?? null;

  const eligible =
    enabled &&
    !!uid &&
    role === 'sub_admin' &&
    !!trustedStationId;

  const scope =
    eligible ? `${uid}:${trustedStationId}` : '';

  const feed = useAssignedIncidents(eligible, scope);

  // Keep the latest authorization available to already-queued GPS writes.
  // A controller created by an earlier render must not use old verification.
  const verificationRef = useRef({
    scope,
    verified: feed.verified,
    verifiedAt: feed.verifiedAt,
  });

  verificationRef.current = {
    scope,
    verified: feed.verified,
    verifiedAt: feed.verifiedAt,
  };

  const [status, setStatus] = useState<TrackingStatus>({
    watching: false,
    sharing: false,
    error: null,
  });

  const [revision, setRevision] = useState(0);
  const sessionRef = useRef<TrackingSession | null>(null);
  const logoutBlockedUidRef = useRef<string | null>(null);
  const previousUidRef = useRef<string | null>(null);

  // Reuse one screen wake lock only while a successful write has
  // confirmed that the device is actively sharing its location.
  const wakeLock = useIncidentWakeLock(status.sharing);

  useEffect(() => {
    if (uid !== previousUidRef.current) {
      previousUidRef.current = uid;
      logoutBlockedUidRef.current = null;
    }

    const existing = sessionRef.current;

    const shutDown = (
      session: TrackingSession,
      forLogout = false,
    ): Promise<void> => {
      if (forLogout) {
        session.logoutRequested = true;
        logoutBlockedUidRef.current = session.uid;
      }

      // Stop receiving GPS fixes immediately, before any async cleanup.
      session.controller.stop();

      setStatus(previous => ({
        ...previous,
        watching: false,
        sharing: false,
      }));

      if (session.shutdown) return session.shutdown;

      const pending = session.controller
        .stopAndSettle()
        .then(() => {
          if (sessionRef.current === session) {
            session.unregister();
            sessionRef.current = null;
            setRevision(value => value + 1);
          }
        })
        .catch((error: unknown) => {
          setStatus(previous => ({
            ...previous,
            error: 'incident-location-cleanup-failed',
          }));
          throw error;
        })
        .finally(() => {
          session.shutdown = null;
        });

      session.shutdown = pending;
      return pending;
    };

    const verifiedAssignments =
      eligible &&
      feed.verified &&
      feed.incidents.length > 0;

    // A failed, missing, or empty feed must revoke tracking.
    if (!verifiedAssignments) {
      if (existing) {
        void shutDown(existing).catch(() => {
          // Keep the registration so cleanup can be retried.
        });
      }
      return;
    }

    // Never resume publishing after the logout sequence has started.
    if (logoutBlockedUidRef.current === uid) return;

    if (existing) {
      if (
        existing.uid !== uid ||
        existing.stationId !== trustedStationId ||
        existing.shutdown !== null ||
        existing.logoutRequested
      ) {
        void shutDown(existing).catch(() => {
          // Fail closed: no replacement session before cleanup.
        });
        return;
      }

      existing.controller.updateIncidents(feed.incidents);
      setStatus(previous => ({
        ...previous,
        watching: existing.controller.active,
      }));
      return;
    }

    if (
      !uid ||
      !trustedStationId ||
      typeof navigator === 'undefined' ||
      !navigator.geolocation
    ) {
      setStatus({
        watching: false,
        sharing: false,
        error: 'geolocation-unavailable',
      });
      return;
    }

    try {
      // This is intentionally constructed only after the trusted
      // incident feed verifies at least one active assignment.
      const writer = createIncidentLocationWriter({
        db,
        uid,
        stationId: trustedStationId,
        getCurrentUid: () => auth.currentUser?.uid ?? null,
      });

      const hasFreshAuthorization = () => {
        const current = verificationRef.current;

        return (
          current.scope === scope &&
          current.verified &&
          isIncidentVerificationFresh(current.verifiedAt) &&
          auth.currentUser?.uid === uid
        );
      };

      const controller = createIncidentLocationController({
        geolocation: navigator.geolocation,
        writeLocation: async (incidentId, fix) => {
          // This runs when the queued GPS write is actually processed,
          // not when the position was originally received.
          if (!hasFreshAuthorization()) {
            controller.stop();
            setStatus(previous => ({
              ...previous,
              watching: false,
              sharing: false,
              error: 'incident-feed-expired',
            }));
            throw new Error('incident-verification-expired');
          }

          await writer.writeLocation(incidentId, fix);

          // A write may finish after authorization expires.
          // Stop and queue deletion rather than treating it as sharing.
          if (!hasFreshAuthorization()) {
            controller.stop();
            setStatus(previous => ({
              ...previous,
              watching: false,
              sharing: false,
              error: 'incident-feed-expired',
            }));
            return;
          }

          // A completed upload must not restore the sharing indicator
          // after revocation, logout, account change, or unmount.
          if (
            sessionRef.current?.controller !== controller ||
            !controller.active ||
            sessionRef.current.shutdown !== null ||
            sessionRef.current.logoutRequested
          ) {
            return;
          }

          setStatus(previous => ({
            ...previous,
            sharing: true,
            error: null,
          }));
        },
        deleteLocation: async () => {
          await writer.deleteLocation();
          setStatus(previous => ({
            ...previous,
            sharing: false,
          }));
        },
        onError: reason => {
          setStatus(previous => ({
            ...previous,
            error: reason,
            sharing: reason === 'geolocation-permission-denied'
              ? false
              : previous.sharing,
          }));
        },
      });

      const session: TrackingSession = {
        uid,
        stationId: trustedStationId,
        controller,
        unregister: () => {},
        shutdown: null,
        logoutRequested: false,
      };

      // Register before starting GPS, so logout can always find
      // the controller and await outstanding Firestore operations.
      session.unregister = incidentLocationCleanupRegistry.register(
        uid,
        async () => {
          await shutDown(session, true);
        },
      );

      sessionRef.current = session;
      controller.start(feed.incidents);

      setStatus({
        watching: controller.active,
        sharing: false,
        error: controller.active ? null : 'geolocation-unavailable',
      });
    } catch (error) {
      setStatus({
        watching: false,
        sharing: false,
        error:
          error instanceof Error ? error.message : 'incident-tracking-failed',
      });
    }
  }, [
    uid,
    trustedStationId,
    eligible,
    feed.verified,
    feed.incidents,
    revision,
  ]);

  // On navigation away, stop GPS synchronously and attempt cleanup.
  // Browser shutdown can interrupt asynchronous deletion; the
  // 90-second reader expiry remains an additional safety boundary.
  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (!session) return;

      session.controller.stop();

      void session.controller.stopAndSettle()
        .then(() => {
          session.unregister();
        })
        .catch(() => {
          // Preserve fail-closed behavior on failed deletion.
        });
    };
  }, []);

  return {
    eligible,
    assignmentsVerified: feed.verified,
    assignmentCount: feed.incidents.length,
    watching: status.watching,
    sharing: status.sharing,
    error: status.error ?? feed.error,
    wakeLockHeld: status.sharing && wakeLock.held,
  };
}