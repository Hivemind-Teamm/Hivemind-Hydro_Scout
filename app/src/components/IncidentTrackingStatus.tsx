'use client';

import { useAuth } from '@/lib/auth-context';
import { useIncidentTracking } from '@/lib/use-incident-tracking';

// Deliberate opt-in. Never enable location publishing by default.
// Production builds are disabled even if the environment flag is set.
const trackingEnabled =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_ENABLE_INCIDENT_TRACKING === 'true';

export default function IncidentTrackingStatus() {
  const { role } = useAuth();
  const tracking = useIncidentTracking(trackingEnabled);

  if (role !== 'sub_admin') return null;

  const label = !trackingEnabled
    ? 'Incident GPS inactive (test gate off)'
    : !tracking.eligible
      ? 'Incident GPS: station verification unavailable'
      : !tracking.assignmentsVerified
        ? 'Incident GPS: checking assignments'
        : tracking.assignmentCount === 0
          ? 'Incident GPS: no active assignment'
          : tracking.sharing
            ? 'Incident GPS: sharing location'
            : tracking.watching
              ? 'Incident GPS: waiting for an accurate nearby fix'
              : 'Incident GPS: not sharing';

  return (
    <section
      aria-label="Incident location status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[4500] max-w-xs rounded-xl border border-neutral-200 bg-white/95 p-3 text-xs text-neutral-800 shadow-lg dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-100"
    >
      <p className="font-semibold">{label}</p>

      {trackingEnabled && tracking.error && (
        <p role="alert" className="mt-1 text-red-600 dark:text-red-400">
          Location notice: {tracking.error}
        </p>
      )}

      {trackingEnabled && tracking.wakeLockHeld && (
        <p className="mt-1">
          Sharing location, screen stays on
        </p>
      )}
    </section>
  );
}