/**
 * route-distance.ts
 * Step 1 of the fire-response formula (docs/formula-spec.md): the distance a
 * hose has to cover from a hydrant to the fire, following mapped paths.
 *
 * The street network (hose-network.ts) is tried first, with Mapbox walking
 * directions asked at the same time in case it fails. When neither answers,
 * `null` is returned and the formula falls back to its straight-line estimate.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export type HoseRouteSource = 'streets' | 'mapbox';

export interface HoseRoute {
  /** Hose distance in metres: the route plus the gap at each end. */
  meters: number;
  source: HoseRouteSource;
  /** `[lng, lat]` points from the hydrant to the fire, for drawing the line. */
  path: [number, number][];
}

/** A route between the points nearest the hydrant and the fire on a network. */
export interface NetworkRoute {
  distanceM: number;
  coordinates: [number, number][];
}

export interface RouteDependencies {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /**
   * Shortest hose path along the street network (`fetchStreetPath` in
   * hose-network.ts); skipped when absent.
   */
  streetPath?: (hydrant: [number, number], fire: [number, number], signal: AbortSignal) => Promise<NetworkRoute | null>;
  /** Mapbox access token; Mapbox is skipped when there is none. */
  mapboxToken: string | undefined;
  /** Straight-line distance in metres between two lat/lng points. */
  distanceM: (lat1: number, lng1: number, lat2: number, lng2: number) => number;
  /** Cancels the whole lookup, e.g. when the fire pin moves. */
  signal?: AbortSignal;
  /** How long to wait on each source before giving up on it. */
  timeoutMs?: number;
}

/** The street network loads map tiles, so it gets longer than a single API call. */
export const ROUTE_TIMEOUT_MS = 10000;

// Walking directions ignore one-way streets but, like every routing service,
// avoid gates and residents-only streets, so they only stand in for the
// street network.
const mapboxUrl = (coords: string, token: string) =>
  `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}?geometries=geojson&overview=full&access_token=${token}`;

interface DirectionsResponse {
  code?: unknown;
  routes?: { distance?: unknown; geometry?: { coordinates?: unknown } }[];
}

function isPath(value: unknown): value is [number, number][] {
  return Array.isArray(value) && value.length >= 2 && value.every((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function isRoute(value: unknown): value is NetworkRoute {
  const route = value as NetworkRoute | null;
  return typeof route?.distanceM === 'number' && Number.isFinite(route.distanceM) && route.distanceM >= 0
    && isPath(route.coordinates);
}

async function mapboxRoute(coords: string, token: string, deps: RouteDependencies, signal: AbortSignal): Promise<NetworkRoute | null> {
  const response = await deps.fetch(mapboxUrl(coords, token), { signal });
  if (!response.ok) return null;
  const data = await response.json() as DirectionsResponse;
  const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
  return { distanceM: route?.distance as number, coordinates: route?.geometry?.coordinates as [number, number][] };
}

/**
 * Starts one source with its own timeout. Resolves to `null` on any failure
 * (network error, timeout, cancellation or a malformed answer); `cancel`
 * stops it early.
 */
function start(run: (signal: AbortSignal) => Promise<NetworkRoute | null>, deps: RouteDependencies) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, deps.timeoutMs ?? ROUTE_TIMEOUT_MS);
  deps.signal?.addEventListener('abort', cancel);
  const aborted = new Promise<null>((resolve) => controller.signal.addEventListener('abort', () => resolve(null)));
  const route = Promise.race([run(controller.signal).then((r) => (isRoute(r) ? r : null), () => null), aborted])
    .finally(() => {
      clearTimeout(timer);
      deps.signal?.removeEventListener('abort', cancel);
    });
  return { route, cancel };
}

export async function fetchHoseRoute(
  hydrant: RoutePoint,
  fire: RoutePoint,
  deps: RouteDependencies,
): Promise<HoseRoute | null> {
  if (deps.signal?.aborted) return null;
  const coords = `${hydrant.lng},${hydrant.lat};${fire.lng},${fire.lat}`;
  const { streetPath, mapboxToken } = deps;

  // Both start at once so a failed street lookup costs no extra wait.
  const attempts: { source: HoseRouteSource; route: Promise<NetworkRoute | null>; cancel: () => void }[] = [];
  if (streetPath) {
    attempts.push({ source: 'streets', ...start((signal) => streetPath([hydrant.lng, hydrant.lat], [fire.lng, fire.lat], signal), deps) });
  }
  if (mapboxToken) {
    attempts.push({ source: 'mapbox', ...start((signal) => mapboxRoute(coords, mapboxToken, deps, signal), deps) });
  }

  try {
    for (const { source, route: pending } of attempts) {
      const route = await pending;
      if (deps.signal?.aborted) return null;
      if (!route) continue;
      // Routes start and end on the nearest mapped path; the hose still has
      // to cover the gap from each pin to that path.
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
  } finally {
    for (const { cancel } of attempts) cancel();
  }
}
