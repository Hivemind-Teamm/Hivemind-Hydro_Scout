// Automatic hydrant claim on arrival (5 m). Emulator-free:
// node --test test/hydrant-auto-claim.test.mjs (Node 24).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTO_CLAIM_DWELL_MS,
  AUTO_CLAIM_FAR_CHECK_MS,
  AUTO_CLAIM_MAX_ACCURACY_M,
  AUTO_CLAIM_NEAR_CHECK_MS,
  AUTO_CLAIM_RADIUS_M,
  nearestTarget,
  planAutoClaim,
  selectAutoClaimTargets,
} from '../lib/hydrant-auto-claim.ts';

const hydrant = (id, status = 'operational') => ({ id, lat: 14.65, lng: 121.06, status });
const T0 = 1_700_000_000_000;

test('defaults agreed for the feature', () => {
  assert.equal(AUTO_CLAIM_RADIUS_M, 5);
  assert.equal(AUTO_CLAIM_DWELL_MS, 5_000);
  assert.equal(AUTO_CLAIM_MAX_ACCURACY_M, 15);
});

test('targets: operational and reduced pressure only, unclaimed, route target included', () => {
  const targets = selectAutoClaimTargets({
    candidates: [hydrant('HYD-001'), hydrant('HYD-002', 'reduced'), hydrant('HYD-003', 'out'),
      hydrant('HYD-004', 'reference'), hydrant('HYD-005')],
    routeTarget: hydrant('HYD-009', 'reduced'),
    claims: [{ hydrantId: 'HYD-005', claimedByUid: 'someone-else', responseId: 'r-2' }],
    uid: 'me',
    responseId: 'r-1',
  });
  assert.deepEqual(targets.map(item => item.id), ['HYD-009', 'HYD-001', 'HYD-002']);
});

test('targets: a route target that is also in the fire list appears once', () => {
  const targets = selectAutoClaimTargets({
    candidates: [hydrant('HYD-001'), hydrant('HYD-002')],
    routeTarget: hydrant('HYD-002'),
    claims: [],
    uid: 'me',
    responseId: 'r-1',
  });
  assert.deepEqual(targets.map(item => item.id), ['HYD-002', 'HYD-001']);
});

test('targets: none once the responder already holds a claim for this response', () => {
  const targets = selectAutoClaimTargets({
    candidates: [hydrant('HYD-001'), hydrant('HYD-002')],
    routeTarget: null,
    claims: [{ hydrantId: 'HYD-007', claimedByUid: 'me', responseId: 'r-1' }],
    uid: 'me',
    responseId: 'r-1',
  });
  assert.deepEqual(targets, []);
});

test('targets: a claim from an earlier response does not block this one', () => {
  const targets = selectAutoClaimTargets({
    candidates: [hydrant('HYD-001')],
    routeTarget: null,
    claims: [{ hydrantId: 'HYD-007', claimedByUid: 'me', responseId: 'r-old' }],
    uid: 'me',
    responseId: 'r-1',
  });
  assert.deepEqual(targets.map(item => item.id), ['HYD-001']);
});

test('two good readings within 5 m, 5 s apart, claim the hydrant', () => {
  const first = planAutoClaim(null, { id: 'HYD-001', distanceM: 3 }, 6, T0);
  assert.equal(first.claimId, null);
  assert.deepEqual(first.dwell, { hydrantId: 'HYD-001', since: T0 });
  assert.equal(first.nextCheckMs, AUTO_CLAIM_DWELL_MS);

  const tooSoon = planAutoClaim(first.dwell, { id: 'HYD-001', distanceM: 2 }, 6, T0 + 2_000);
  assert.equal(tooSoon.claimId, null);
  assert.equal(tooSoon.nextCheckMs, 3_000);

  const second = planAutoClaim(first.dwell, { id: 'HYD-001', distanceM: 4 }, 6, T0 + AUTO_CLAIM_DWELL_MS);
  assert.equal(second.claimId, 'HYD-001');
  assert.equal(second.dwell, null);
});

test('driving past a hydrant does not claim it', () => {
  const passing = planAutoClaim(null, { id: 'HYD-001', distanceM: 4 }, 6, T0);
  const gone = planAutoClaim(passing.dwell, { id: 'HYD-001', distanceM: 60 }, 6, T0 + 5_000);
  assert.equal(gone.claimId, null);
  assert.equal(gone.dwell, null, 'leaving the radius resets the wait');
});

test('exactly 5 m counts; 5.1 m does not', () => {
  assert.notEqual(planAutoClaim(null, { id: 'HYD-001', distanceM: 5 }, 6, T0).dwell, null);
  assert.equal(planAutoClaim(null, { id: 'HYD-001', distanceM: 5.1 }, 6, T0).dwell, null);
});

test('rough GPS readings are not trusted, but do not reset the wait', () => {
  const rough = planAutoClaim(null, { id: 'HYD-001', distanceM: 2 }, AUTO_CLAIM_MAX_ACCURACY_M + 1, T0);
  assert.equal(rough.claimId, null);
  assert.equal(rough.dwell, null);
  assert.equal(rough.nextCheckMs, AUTO_CLAIM_NEAR_CHECK_MS);

  const first = planAutoClaim(null, { id: 'HYD-001', distanceM: 2 }, 5, T0);
  const roughAfter = planAutoClaim(first.dwell, { id: 'HYD-001', distanceM: 2 }, 40, T0 + 3_000);
  assert.deepEqual(roughAfter.dwell, first.dwell);
  const good = planAutoClaim(roughAfter.dwell, { id: 'HYD-001', distanceM: 2 }, 5, T0 + 6_000);
  assert.equal(good.claimId, 'HYD-001');
});

test('moving to a different hydrant restarts the wait', () => {
  const first = planAutoClaim(null, { id: 'HYD-001', distanceM: 3 }, 5, T0);
  const other = planAutoClaim(first.dwell, { id: 'HYD-002', distanceM: 3 }, 5, T0 + 6_000);
  assert.equal(other.claimId, null);
  assert.deepEqual(other.dwell, { hydrantId: 'HYD-002', since: T0 + 6_000 });
});

test('check spacing follows the distance to the nearest hydrant', () => {
  assert.equal(planAutoClaim(null, null, 5, T0).nextCheckMs, AUTO_CLAIM_FAR_CHECK_MS);
  assert.equal(planAutoClaim(null, { id: 'HYD-001', distanceM: 80 }, 5, T0).nextCheckMs, AUTO_CLAIM_NEAR_CHECK_MS);
  // 505 m: 500 m to go at 25 m/s = 20 s.
  assert.equal(planAutoClaim(null, { id: 'HYD-001', distanceM: 505 }, 5, T0).nextCheckMs, 20_000);
  assert.equal(planAutoClaim(null, { id: 'HYD-001', distanceM: 5_000 }, 5, T0).nextCheckMs, AUTO_CLAIM_FAR_CHECK_MS);
});

test('nearestTarget picks the closest finite distance', () => {
  assert.deepEqual(nearestTarget([{ id: 'a', distanceM: 9 }, { id: 'b', distanceM: NaN }, { id: 'c', distanceM: 4 }]),
    { id: 'c', distanceM: 4 });
  assert.equal(nearestTarget([]), null);
});
