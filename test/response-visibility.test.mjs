// Responder visibility: shown to other users only within 1 km of the fire.
// Emulator-free: node --test test/response-visibility.test.mjs (Node 24).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  INITIAL_SHARING_STATE,
  RESPONSE_APPROACH_SPEED_MPS,
  RESPONSE_HEARTBEAT_MS,
  RESPONSE_INSIDE_CHECK_MS,
  RESPONSE_MIN_CHECK_MS,
  RESPONSE_MOVE_PUBLISH_MIN_MS,
  RESPONSE_VISIBILITY_EXIT_MARGIN_M,
  RESPONSE_VISIBILITY_RADIUS_M,
  isInsideVisibility,
  planResponseSharing,
} from '../lib/response-visibility.ts';
import { FIRE_RESPONSE_CONFIG } from '../lib/fire-response.config.ts';

const FIX = { lat: 14.65, lng: 121.06 };
const T0 = 1_700_000_000_000;

/** State after a start from `distanceM` away (the create counts as the heartbeat). */
function started(distanceM) {
  const plan = planResponseSharing({ ...INITIAL_SHARING_STATE, published: false }, FIX, distanceM, Infinity, T0);
  return { plan, state: { ...plan.next, lastHeartbeatAt: T0 } };
}

test('the radius matches firestore.rules', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const match = rules.match(/function responseVisibilityRadiusM\(\)\s*\{\s*return (\d+);/);
  assert.ok(match, 'firestore.rules must define responseVisibilityRadiusM()');
  assert.equal(Number(match[1]), RESPONSE_VISIBILITY_RADIUS_M);
  assert.equal(RESPONSE_VISIBILITY_RADIUS_M, 1000);
});

test('the hydrant search radius and its 500 m expansion are unchanged', () => {
  assert.equal(FIRE_RESPONSE_CONFIG.hydrantSearchRadiusM, 1000);
  assert.equal(FIRE_RESPONSE_CONFIG.hydrantSearchExpansionM, 500);
});

test('starting inside 1 km publishes at once', () => {
  const { plan } = started(400);
  assert.equal(plan.publish, true);
  assert.equal(plan.remove, false);
  assert.equal(plan.next.published, true);
  assert.equal(plan.nextCheckMs, RESPONSE_INSIDE_CHECK_MS);
});

test('starting outside 1 km publishes nothing and deletes nothing', () => {
  const { plan } = started(3_000);
  assert.equal(plan.publish, false);
  assert.equal(plan.remove, false, 'no marker exists yet, so there is nothing to delete');
  assert.equal(plan.next.published, false);
});

test('outside: the check interval follows the distance to the edge', () => {
  // 1.2 km away: 200 m to go at 25 m/s = 8 s, floored to the minimum.
  assert.equal(started(1_200).plan.nextCheckMs, RESPONSE_MIN_CHECK_MS);
  // 2 km away: 1000 m / 25 m/s = 40 s.
  assert.equal(started(2_000).plan.nextCheckMs, (1_000 / RESPONSE_APPROACH_SPEED_MPS) * 1000);
  // Far away: capped at the heartbeat.
  assert.equal(started(50_000).plan.nextCheckMs, RESPONSE_HEARTBEAT_MS);
});

test('outside: no writes between heartbeats, heartbeat only when due', () => {
  const { state } = started(3_000);
  const early = planResponseSharing(state, FIX, 2_900, Infinity, T0 + 60_000);
  assert.deepEqual([early.publish, early.remove, early.heartbeat], [false, false, false]);
  assert.ok(early.nextCheckMs <= RESPONSE_HEARTBEAT_MS - 60_000, 'next check lands no later than the heartbeat');
  const due = planResponseSharing(state, FIX, 2_900, Infinity, T0 + RESPONSE_HEARTBEAT_MS);
  assert.deepEqual([due.publish, due.remove, due.heartbeat], [false, false, true]);
  assert.equal(due.next.lastHeartbeatAt, T0 + RESPONSE_HEARTBEAT_MS);
});

test('entering the radius publishes immediately, without waiting for the heartbeat', () => {
  const { state } = started(1_500);
  const entered = planResponseSharing(state, FIX, 980, Infinity, T0 + 20_000);
  assert.equal(entered.publish, true);
  assert.equal(entered.heartbeat, false, 'the response heartbeat keeps its own schedule');
  assert.equal(entered.next.inside, true);
  assert.equal(entered.next.published, true);
});

test('inside: republish on the heartbeat, or early after moving 100 m', () => {
  const { state } = started(500);
  const still = planResponseSharing(state, FIX, 500, 20, T0 + RESPONSE_INSIDE_CHECK_MS);
  assert.equal(still.publish, false, 'standing still: no write before the heartbeat');
  const moved = planResponseSharing(state, FIX, 400, 150, T0 + RESPONSE_MOVE_PUBLISH_MIN_MS);
  assert.equal(moved.publish, true);
  const movedTooSoon = planResponseSharing(state, FIX, 400, 150, T0 + 20_000);
  assert.equal(movedTooSoon.publish, false, 'at most one movement write per minute');
  const heartbeat = planResponseSharing(state, FIX, 500, 0, T0 + RESPONSE_HEARTBEAT_MS);
  assert.deepEqual([heartbeat.publish, heartbeat.heartbeat], [true, true]);
});

test('hysteresis: GPS jitter at the edge does not flicker the marker', () => {
  assert.equal(isInsideVisibility(RESPONSE_VISIBILITY_RADIUS_M + 1, false), false);
  assert.equal(isInsideVisibility(RESPONSE_VISIBILITY_RADIUS_M + 1, true), true);
  assert.equal(isInsideVisibility(RESPONSE_VISIBILITY_RADIUS_M + RESPONSE_VISIBILITY_EXIT_MARGIN_M + 1, true), false);

  const { state } = started(990);
  // Just past 1 km: still shown at the last position inside, and never
  // written there (the rules would refuse it).
  const band = planResponseSharing(state, FIX, 1_030, 200, T0 + RESPONSE_HEARTBEAT_MS);
  assert.deepEqual([band.publish, band.remove, band.heartbeat], [false, false, true]);
  assert.equal(band.next.published, true);
});

test('leaving the radius removes the marker once', () => {
  const { state } = started(900);
  const left = planResponseSharing(state, FIX, 1_200, 300, T0 + 30_000);
  assert.equal(left.remove, true);
  assert.equal(left.next.published, false);
  const after = planResponseSharing(left.next, FIX, 1_300, 300, T0 + 60_000);
  assert.equal(after.remove, false, 'already removed: no repeat delete');
});

test('after a reload (marker state unknown) the first fix settles it', () => {
  const outside = planResponseSharing(INITIAL_SHARING_STATE, FIX, 5_000, Infinity, T0);
  assert.equal(outside.remove, true, 'clears a marker that may be left from before the reload');
  const inside = planResponseSharing(INITIAL_SHARING_STATE, FIX, 300, Infinity, T0);
  assert.equal(inside.publish, true);
});
