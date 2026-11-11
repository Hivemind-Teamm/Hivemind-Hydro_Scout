/**
 * route-distance.ts
 * Step 1 of the fire-response formula (docs/formula-spec.md): the distance a
 * hose has to cover from a hydrant to the fire, following mapped paths.
 *
 * The street network (hose-network.ts) is tried first, with Mapbox walking
 * directions asked at the same time in case it fails. When neither answers,
 * `null` is returned and the formula falls back to its straight-line estimate.
 *
 * The supply line ends where the engine at the fire parks: the last road
 * point on the way to the fire. A fire set back from the road (inside a
 * building or a lot) is reached from there by the engine's own attack line,
 * along footpaths and walkways or straight in, so no truck is ever placed
 * off the road.
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export type HoseRouteSource = 'streets' | 'mapbox';

export interface HoseRoute {
  /**
   * Supply hose distance in metres: the gap from the hydrant to the route,
   * plus the route up to the street point nearest the fire.
   */
  meters: number;
  /**
   * From where the engine parks to the fire, in metres: along any footpaths
   * past the last road, then straight to the pin. Covered by the engine's
   * attack line, not the supply line.
   */
  attackLineM: number;
  source: HoseRouteSource;
  /** `[lng, lat]` points from the hydrant to the fire, for drawing the line. */
  path: [number, number][];
  /**
   * `[lng, lat]` points from the hydrant to where the engine parks on the
   * road: the part of `path` the supply trucks stand on.
   */
  supplyPath: [number, number][];
}

/** A route between the points nearest the hydrant and the fire on a network. */
export interface NetworkRoute {
  /** Supply line, up to where the engine parks. */
  distanceM: number;
  coordinates: [number, number][];
  /** Attack line along the network from where the engine parks, when the fire is off the road. */
  attack?: { distanceM: number; coordinates: [number, number][] };
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

const isLength = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isRoute(value: unknown): value is NetworkRoute {
  const route = value as NetworkRoute | null;
  return isLength(route?.distanceM) && isPath(route.coordinates)
    && (route.attack === undefined || (isLength(route.attack.distanceM) && isPath(route.attack.coordinates)));
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
      // Routes start and end on the nearest mapped path. The supply hose
      // still covers the gap from the hydrant to that path; the attack line
      // covers any footpaths past the last road and the gap to the fire.
      const [startLng, startLat] = route.coordinates[0];
      const attack = route.attack?.coordinates.slice(1) ?? [];
      const [endLng, endLat] = attack.at(-1) ?? route.coordinates[route.coordinates.length - 1];
      const supplyPath: [number, number][] = [[hydrant.lng, hydrant.lat], ...route.coordinates];
      return {
        meters: route.distanceM + deps.distanceM(hydrant.lat, hydrant.lng, startLat, startLng),
        attackLineM: (route.attack?.distanceM ?? 0) + deps.distanceM(endLat, endLng, fire.lat, fire.lng),
        source,
        path: [...supplyPath, ...attack, [fire.lng, fire.lat]],
        supplyPath,
      };
    }
    return null;
  } finally {
    for (const { cancel } of attempts) cancel();
  }
}
