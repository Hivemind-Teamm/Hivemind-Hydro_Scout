'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ActiveIncidentLocation } from './incident-location-algorithm';
import { createIncidentFeedPollingController } from './incident-feed-polling.mjs';

const IDLE_POLL_INTERVAL_MS = 20_000;

interface FeedState {
  session: object | null;
  scope: string;
  incidents: ActiveIncidentLocation[];
  error: string | null;
  verified: boolean;
  verifiedAt: number | null;
}

function emptyState(scope: string): FeedState {
  return {
    session: null,
    scope,
    incidents: [],
    error: null,
    verified: false,
    verifiedAt: null,
  };
}

/**
 * Read-only trusted incident assignment feed.
 *
 * Polling is scoped to the authenticated user and station.
 * This hook never watches GPS or writes to Firestore.
 */
export function useAssignedIncidents(
  enabled: boolean,
  scope: string,
): FeedState {
  // A new object identifies each enabled/scope lifecycle.
  // Re-enabling the same scope must not reuse previous verification.
  const session = useMemo(() => ({}), [enabled, scope]);

  const [state, setState] = useState<FeedState>(
    () => emptyState(scope),
  );

  useEffect(() => {
    if (!enabled || !scope) return;

    const controller = createIncidentFeedPollingController({
      // Each poll costs several Firestore reads on the server. With nothing
      // assigned, a new assignment is picked up within 20 s; while incidents
      // are active the 5 s default keeps location sharing verified.
      idleIntervalMs: IDLE_POLL_INTERVAL_MS,
      fetchFeed: (signal: AbortSignal) =>
        fetch('/api/incidents', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        }),

      onChange: (next: Omit<FeedState, 'scope'>) => {
        setState({
          session,
          scope,
          incidents: next.incidents,
          verified: next.verified,
          verifiedAt: next.verified ? Date.now() : null,
          error: next.error,
        });
      },
    });

    controller.start();

    return () => {
      controller.stop();
    };
  }, [enabled, scope, session]);

  // Require fresh verification for every activation, including
  // disable/re-enable transitions involving the same account.
  if (
    !enabled ||
    !scope ||
    state.scope !== scope ||
    state.session !== session
  ) {
    return emptyState(scope);
  }

  return state;
}