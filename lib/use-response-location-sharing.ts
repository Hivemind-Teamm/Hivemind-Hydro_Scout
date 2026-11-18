'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { haversineM } from './haversine';
import {
  INITIAL_SHARING_STATE,
  RESPONSE_MIN_CHECK_MS,
  RESPONSE_RETRY_MS,
  planResponseSharing,
  type ResponseSharingState,
} from './response-visibility';

/**
 * Live location for an active response, shown to other users only inside the
 * fire's visibility radius (see response-visibility.ts).
 *
 * One GPS loop runs per active response. GPS checks are spaced by how far the
 * responder is from the radius (far away = rare, near the edge = every 10 s),
 * and Firestore is written only when the marker must appear, move, refresh or
 * disappear, plus the three-minute `lastLocationAt` heartbeat.
 */

export type ResponseVisibilityPhase = 'locating' | 'visible' | 'hidden' | 'paused' | 'unavailable';

export type ResponseVisibility = {
  responseId: string;
  phase: ResponseVisibilityPhase;
  /** Distance to the fire, rounded to 10 m; null before the first fix. */
  distanceM: number | null;
};

export type ResponseSharingTarget = {
  responseId: string;
  stationId: string;
  stationName: string;
  fireLat: number;
  fireLng: number;
};

// ── Module store ─────────────────────────────────────────────────────────────
// Read through selectors, so a component re-renders only when the value it
// selects changes (the dashboard selects a boolean, not every distance).

let current: ResponseVisibility | null = null;
const listeners = new Set<() => void>();
/** Sharing state per response; survives effect restarts (fire moved, etc.). */
const sharingStates = new Map<string, ResponseSharingState>();
/** First check delay for a response that was just started. */
const primedDelays = new Map<string, number>();

function setVisibility(next: ResponseVisibility | null) {
  if (current === next) return;
  if (current && next && current.responseId === next.responseId
    && current.phase === next.phase && current.distanceM === next.distanceM) return;
  current = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Select from the active response's visibility. Return primitives or stable values. */
export function useResponseVisibility<T>(select: (visibility: ResponseVisibility | null) => T): T {
  return useSyncExternalStore(subscribe, () => select(current), () => select(null));
}

const roundDistance = (metres: number) => Math.round(metres / 10) * 10;

function phaseFor(state: ResponseSharingState): ResponseVisibilityPhase {
  return state.published === true ? 'visible' : 'hidden';
}

/** Record the outcome of a response start so the loop doesn't redo it at once. */
export function primeResponseSharing(responseId: string, state: ResponseSharingState, distanceM: number, nextCheckMs: number) {
  sharingStates.set(responseId, state);
  primedDelays.set(responseId, nextCheckMs);
  setVisibility({ responseId, phase: phaseFor(state), distanceM: roundDistance(distanceM) });
}

export function forgetResponseSharing(responseId: string) {
  sharingStates.delete(responseId);
  primedDelays.delete(responseId);
  if (current?.responseId === responseId) setVisibility(null);
}

export function readResponsePosition(): Promise<GeolocationPosition> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('This device does not support location sharing.'));
  }
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, error => {
    reject(new Error(error.code === error.PERMISSION_DENIED
      ? 'Allow location access in your browser before starting a response.'
      : 'Could not get your current location. Check your GPS and try again.'));
  }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 }));
}

/** Public marker document for a response, in the shape firestore.rules accepts. */
export function responseMarker(target: Pick<ResponseSharingTarget, 'responseId' | 'stationId' | 'stationName'>, coords: GeolocationCoordinates) {
  return {
    responseId: target.responseId,
    stationId: target.stationId,
    stationName: target.stationName,
    public: true,
    lat: coords.latitude,
    lng: coords.longitude,
    accuracy: coords.accuracy,
    updatedAt: serverTimestamp(),
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useResponseLocationSharing(target: ResponseSharingTarget | null, enabled: boolean) {
  const responseId = target?.responseId ?? null;
  const stationId = target?.stationId ?? null;
  const stationName = target?.stationName ?? null;
  const fireLat = target?.fireLat ?? null;
  const fireLng = target?.fireLng ?? null;
  const fireRef = useRef<{ lat: number; lng: number } | null>(null);
  const checkNowRef = useRef<(() => void) | null>(null);

  // The fire can be moved while responding: recheck against the new spot
  // without restarting the loop.
  useEffect(() => {
    fireRef.current = fireLat !== null && fireLng !== null ? { lat: fireLat, lng: fireLng } : null;
    checkNowRef.current?.();
  }, [fireLat, fireLng]);

  useEffect(() => {
    if (!responseId || !stationId || !stationName) {
      if (!responseId) setVisibility(null);
      return;
    }
    const marker = doc(db, 'stations', stationId, 'unitLocations', responseId);

    if (!enabled) {
      // Consent withdrawn: take the marker (and any legacy copy) down once.
      setVisibility({ responseId, phase: 'paused', distanceM: null });
      const state = sharingStates.get(responseId) ?? INITIAL_SHARING_STATE;
      if (state.published !== false) {
        const batch = writeBatch(db);
        batch.delete(marker);
        batch.delete(doc(db, 'responseLocations', responseId));
        void batch.commit()
          .then(() => { sharingStates.set(responseId, { ...state, inside: null, published: false }); })
          .catch(err => { console.error('Could not remove the location after consent withdrawal:', err); });
      }
      return;
    }

    let stopped = false;
    let running = false;
    let rerun = false;
    let lastCheckAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => { void check(); }, ms);
    };

    const check = async () => {
      if (stopped) return;
      if (running) { rerun = true; return; }
      running = true;
      clearTimeout(timer);
      lastCheckAt = Date.now();
      let delay = RESPONSE_RETRY_MS;
      try {
        if (!fireRef.current) return;
        if (!sharingStates.has(responseId)) setVisibility({ responseId, phase: 'locating', distanceM: null });
        const position = await readResponsePosition();
        const fire = fireRef.current;
        if (stopped || !fire) return;
        const { latitude: lat, longitude: lng } = position.coords;
        const distanceM = haversineM(lat, lng, fire.lat, fire.lng);
        const state = sharingStates.get(responseId) ?? INITIAL_SHARING_STATE;
        const movedM = state.lastPublishLat === null || state.lastPublishLng === null
          ? Infinity : haversineM(lat, lng, state.lastPublishLat, state.lastPublishLng);
        const plan = planResponseSharing(state, { lat, lng }, distanceM, movedM, Date.now());

        if (plan.publish || plan.remove || plan.heartbeat) {
          if (!navigator.onLine) {
            // Nothing is queued offline; the `online` event triggers a fresh check.
            setVisibility({ responseId, phase: phaseFor(state), distanceM: roundDistance(distanceM) });
            delay = plan.nextCheckMs;
            return;
          }
          const batch = writeBatch(db);
          if (plan.publish) batch.set(marker, responseMarker({ responseId, stationId, stationName }, position.coords));
          if (plan.remove) batch.delete(marker);
          if (plan.heartbeat) batch.update(doc(db, 'stationResponses', responseId), { lastLocationAt: serverTimestamp() });
          await batch.commit();
        }
        // Keep the outcome even if the effect stopped mid-write: the write happened.
        sharingStates.set(responseId, plan.next);
        if (stopped) return;
        setVisibility({ responseId, phase: phaseFor(plan.next), distanceM: roundDistance(distanceM) });
        delay = plan.nextCheckMs;
      } catch (err) {
        console.warn('Active response location was not updated:', err);
        if (!stopped) {
          setVisibility({
            responseId,
            phase: 'unavailable',
            distanceM: current?.responseId === responseId ? current.distanceM : null,
          });
        }
      } finally {
        running = false;
        if (!stopped) schedule(rerun ? 0 : delay);
        rerun = false;
      }
    };

    // Fire moved: always recheck. Focus/visibility/online: at most every 10 s.
    checkNowRef.current = () => { void check(); };
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckAt >= RESPONSE_MIN_CHECK_MS) void check();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);

    const primed = primedDelays.get(responseId);
    primedDelays.delete(responseId);
    if (primed !== undefined) {
      lastCheckAt = Date.now();
      schedule(primed);
    } else {
      void check();
    }

    return () => {
      stopped = true;
      clearTimeout(timer);
      checkNowRef.current = null;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [responseId, stationId, stationName, enabled]);
}
