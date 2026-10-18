'use client';

import { useEffect, useMemo, useState } from 'react';
import { FIRE_RESPONSE_CONFIG } from './fire-response.config';
import type { FireHydrantCandidate } from './fire-response';
import { haversineM } from './haversine';
import { fetchHoseRoute, type HoseRoute } from './route-distance';
import { estimateSupplyLine, type SupplyLineEstimate } from './supply-line';

export interface SupplyLine {
  estimate: SupplyLineEstimate;
  /**
   * `[lng, lat]` points of the routed line, hydrant first. `null` until a
   * route arrives or when routing failed — draw a straight line then.
   */
  path: [number, number][] | null;
  /**
   * `loading` while the route is looked up, `failed` when no routing service
   * answered. Either way the estimate is the straight-line fallback.
   */
  routing: 'loading' | 'routed' | 'failed';
}

/**
 * Hose and truck estimate for the supply line from `supply` to `fire`.
 *
 * Answers at once with the straight-line estimate, then replaces it with the
 * routed one when a routing service answers.
 */
export function useSupplyLine(
  fire: { lat: number; lng: number } | null,
  supply: FireHydrantCandidate | null,
): SupplyLine | null {
  const fireLat = fire?.lat;
  const fireLng = fire?.lng;
  const hydrantLat = supply?.hydrant.lat;
  const hydrantLng = supply?.hydrant.lng;
  const straightLineM = supply?.distanceM;
  // Keyed on coordinates: the candidate objects are rebuilt whenever the
  // hydrant feed ticks, and that must not trigger a new lookup.
  const key = fireLat === undefined || fireLng === undefined || hydrantLat === undefined || hydrantLng === undefined
    ? null : `${hydrantLng},${hydrantLat};${fireLng},${fireLat}`;

  const [fetched, setFetched] = useState<{ key: string; route: HoseRoute | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (key === null || fireLat === undefined || fireLng === undefined
      || hydrantLat === undefined || hydrantLng === undefined) return;
    const controller = new AbortController();
    void fetchHoseRoute({ lat: hydrantLat, lng: hydrantLng }, { lat: fireLat, lng: fireLng }, {
      fetch: (url, init) => fetch(url, init),
      mapboxToken: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
      distanceM: haversineM,
      signal: controller.signal,
    }).then((route) => {
      if (!controller.signal.aborted) setFetched({ key, route });
    });
    return () => controller.abort();
  }, [key, attempt, fireLat, fireLng, hydrantLat, hydrantLng]);

  // Never show another pair's route while a new lookup is in flight.
  const current = key !== null && fetched?.key === key ? fetched : null;
  const route = current?.route ?? null;
  const failed = current !== null && current.route === null;
  const routing = current === null ? 'loading' : failed ? 'failed' : 'routed';

  // Routing fails when the connection drops, which is likely at a fire scene:
  // look the route up again once the connection is back.
  useEffect(() => {
    if (!failed) return;
    const retry = () => setAttempt((count) => count + 1);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failed]);

  return useMemo(() => (straightLineM === undefined ? null : {
    estimate: estimateSupplyLine(
      { straightLineM, route: route && { meters: route.meters, source: route.source } },
      FIRE_RESPONSE_CONFIG,
    ),
    path: route?.path ?? null,
    routing,
  }), [straightLineM, route, routing]);
}
