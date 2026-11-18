/**
 * When a responder's live location is shown to other users.
 *
 * A responder who presses "Start response" is placed on other users' maps only
 * while they are within RESPONSE_VISIBILITY_RADIUS_M of the fire they respond
 * to. Outside it nothing is published; the response stays alive with a
 * `lastLocationAt` heartbeat on the private response record.
 *
 * This radius is fixed. It is NOT the hydrant search radius, which grows in
 * 500 m bands when no hydrant is found (see fire-response.config.ts).
 *
 * firestore.rules enforces the same radius (`responseVisibilityRadiusM()`);
 * test/response-visibility.test.mjs fails if the two differ.
 *
 * Pure and import-free so Node can unit-test it directly.
 */

export const RESPONSE_VISIBILITY_RADIUS_M = 1000;

/** Once shown, a responder is hidden again only past this extra margin, so
 *  GPS jitter at the edge doesn't make the marker flicker on and off. */
export const RESPONSE_VISIBILITY_EXIT_MARGIN_M = 50;

/** Heartbeat for the response record and the published marker (unchanged
 *  from the earlier fixed three-minute refresh). */
export const RESPONSE_HEARTBEAT_MS = 3 * 60_000;

/** Fastest approach speed assumed when deciding how soon to check again
 *  (90 km/h). A unit at this speed is caught within one check of entering. */
export const RESPONSE_APPROACH_SPEED_MPS = 25;

/** Closest spacing between GPS checks while approaching the radius. */
export const RESPONSE_MIN_CHECK_MS = 10_000;

/** GPS check spacing while inside the radius. */
export const RESPONSE_INSIDE_CHECK_MS = 60_000;

/** Inside the radius, republish early when moved at least this far... */
export const RESPONSE_MOVE_PUBLISH_M = 100;
/** ...but no more often than this. */
export const RESPONSE_MOVE_PUBLISH_MIN_MS = 60_000;

/** Retry spacing after a failed GPS read or write. */
export const RESPONSE_RETRY_MS = 30_000;

/** A fraction of a second of timer drift must not skip a heartbeat. */
const DUE_SLACK_MS = 1_000;

export type ResponseSharingState = {
  /** Inside the visibility radius at the last check; null before the first fix. */
  inside: boolean | null;
  /** Whether the public marker exists; null when unknown (e.g. after a reload). */
  published: boolean | null;
  lastPublishAt: number | null;
  lastPublishLat: number | null;
  lastPublishLng: number | null;
  lastHeartbeatAt: number | null;
};

export const INITIAL_SHARING_STATE: ResponseSharingState = {
  inside: null,
  published: null,
  lastPublishAt: null,
  lastPublishLat: null,
  lastPublishLng: null,
  lastHeartbeatAt: null,
};

export type SharingPlan = {
  /** Write the public marker (and the heartbeat when `heartbeat` is true). */
  publish: boolean;
  /** Delete the public marker. */
  remove: boolean;
  /** Update `lastLocationAt` on the private response record. */
  heartbeat: boolean;
  /** State to keep once the writes above succeed. */
  next: ResponseSharingState;
  /** When to check the position again. */
  nextCheckMs: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Inside test with hysteresis: enter at the radius, leave past radius + margin. */
export function isInsideVisibility(distanceM: number, wasInside: boolean | null): boolean {
  return distanceM <= RESPONSE_VISIBILITY_RADIUS_M + (wasInside ? RESPONSE_VISIBILITY_EXIT_MARGIN_M : 0);
}

/**
 * Decide what to write for one GPS fix.
 *
 * @param distanceM distance from the fix to the fire, in metres
 * @param movedM distance from the fix to the last published position (Infinity if none)
 */
export function planResponseSharing(
  state: ResponseSharingState,
  fix: { lat: number; lng: number },
  distanceM: number,
  movedM: number,
  now: number,
): SharingPlan {
  const inside = isInsideVisibility(distanceM, state.inside);
  const sinceHeartbeat = state.lastHeartbeatAt === null ? Infinity : now - state.lastHeartbeatAt;
  const sincePublish = state.lastPublishAt === null ? Infinity : now - state.lastPublishAt;
  const heartbeatDue = sinceHeartbeat >= RESPONSE_HEARTBEAT_MS - DUE_SLACK_MS;
  const untilHeartbeat = Math.max(RESPONSE_MIN_CHECK_MS, RESPONSE_HEARTBEAT_MS - Math.min(sinceHeartbeat, RESPONSE_HEARTBEAT_MS));

  // Only write a marker the security rules will accept: inside the hysteresis
  // margin the responder stays shown at their last position inside the radius.
  const publish = inside && distanceM <= RESPONSE_VISIBILITY_RADIUS_M && (
    state.published !== true
    || sincePublish >= RESPONSE_HEARTBEAT_MS - DUE_SLACK_MS
    || (movedM >= RESPONSE_MOVE_PUBLISH_M && sincePublish >= RESPONSE_MOVE_PUBLISH_MIN_MS - DUE_SLACK_MS)
  );
  const remove = !inside && state.published !== false;
  const heartbeat = heartbeatDue;

  const next: ResponseSharingState = {
    inside,
    published: publish ? true : remove ? false : state.published,
    lastPublishAt: publish ? now : state.lastPublishAt,
    lastPublishLat: publish ? fix.lat : state.lastPublishLat,
    lastPublishLng: publish ? fix.lng : state.lastPublishLng,
    lastHeartbeatAt: heartbeat ? now : state.lastHeartbeatAt,
  };

  const untilNextHeartbeat = heartbeat ? RESPONSE_HEARTBEAT_MS : untilHeartbeat;
  const nextCheckMs = inside
    ? Math.min(RESPONSE_INSIDE_CHECK_MS, untilNextHeartbeat)
    : Math.min(
      clamp(((distanceM - RESPONSE_VISIBILITY_RADIUS_M) / RESPONSE_APPROACH_SPEED_MPS) * 1000, RESPONSE_MIN_CHECK_MS, RESPONSE_HEARTBEAT_MS),
      untilNextHeartbeat,
    );

  return { publish, remove, heartbeat, next, nextCheckMs };
}
