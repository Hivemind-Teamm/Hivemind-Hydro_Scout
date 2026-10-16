/**
 * route-distance.ts
 * Step 1 of the fire-response formula (docs/formula-spec.md): the distance a
 * hose has to cover from a hydrant to the fire, following mapped paths.
 *
 * Mapbox Directions is tried first, then OSRM. When neither answers, `null`
 * is returned and the formula falls back to its straight-line estimate.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface HoseRoute {
  /** Hose distance in metres: the route plus the gap at each end. */
  meters: number;
  source: 'mapbox' | 'osrm';
  /** `[lng, lat]` points from the hydrant to the fire, for drawing the line. */
  path: [number, number][];
}

export interface RouteDependencies {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /** Mapbox access token; Mapbox is skipped when there is none. */
  mapboxToken: string | undefined;
  /** Straight-line distance in metres between two lat/lng points. */
  distanceM: (lat1: number, lng1: number, lat2: number, lng2: number) => number;
  /** Cancels the whole lookup, e.g. when the fire pin moves. */
  signal?: AbortSignal;
  /** How long to wait on each service before trying the next one. */
  timeoutMs?: number;
}

export const ROUTE_TIMEOUT_MS = 6000;

// Hose is not bound by one-way streets and can run through alleys, so the
// walking route stands in for the hose path.
const mapboxUrl = (coords: string, token: string) =>
  `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&access_token=${token}`;

// The public OSRM server only has driving data and answers every profile
// with it, so this distance can be longer than the walking route.
const osrmUrl = (coords: string) =>
  `https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`;

interface DirectionsResponse {
  code?: unknown;
  routes?: { distance?: unknown; geometry?: { coordinates?: unknown } }[];
}

function isPath(value: unknown): value is [number, number][] {
  return Array.isArray(value) && value.length >= 2 && value.every((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

async function requestRoute(
  url: string,
  deps: RouteDependencies,
): Promise<{ distanceM: number; coordinates: [number, number][] } | null> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, deps.timeoutMs ?? ROUTE_TIMEOUT_MS);
  deps.signal?.addEventListener('abort', cancel);
  try {
    const response = await deps.fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json() as DirectionsResponse;
    const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
    const distanceM = route?.distance;
    const coordinates = route?.geometry?.coordinates;
    if (typeof distanceM !== 'number' || !Number.isFinite(distanceM) || distanceM < 0 || !isPath(coordinates)) {
      return null;
    }
    return { distanceM, coordinates };
  } catch {
    return null; // network error, timeout, cancellation or a malformed body
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', cancel);
  }
}

export async function fetchHoseRoute(
  hydrant: RoutePoint,
  fire: RoutePoint,
  deps: RouteDependencies,
): Promise<HoseRoute | null> {
  const coords = `${hydrant.lng},${hydrant.lat};${fire.lng},${fire.lat}`;
  const services: { source: HoseRoute['source']; url: string }[] = [];
  if (deps.mapboxToken) services.push({ source: 'mapbox', url: mapboxUrl(coords, deps.mapboxToken) });
  services.push({ source: 'osrm', url: osrmUrl(coords) });

  for (const { source, url } of services) {
    if (deps.signal?.aborted) return null;
    const route = await requestRoute(url, deps);
    if (!route) continue;
    // Services start and end the route on the nearest mapped path; the hose
    // still has to cover the gap from each pin to that path.
    const [startLng, startLat] = route.coordinates[0];
    const [endLng, endLat] = route.coordinates[route.coordinates.length - 1];
    const gapsM = deps.distanceM(hydrant.lat, hydrant.lng, startLat, startLng)
      + deps.distanceM(endLat, endLng, fire.lat, fire.lng);
    return {
      meters: route.distanceM + gapsM,
      source,
      path: [[hydrant.lng, hydrant.lat], ...route.coordinates, [fire.lng, fire.lat]],
    };
  }
  return null;
}
