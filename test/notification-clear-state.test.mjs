import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hideClearedNotifications, nextClearedBefore, notificationClearKey, parseClearedBefore } from '../lib/notification-clear-state.ts';
import { DEFAULT_VISIBLE_STATUSES, STATUS_ORDER } from '../app/src/data/hydrants.ts';

const at = ms => ({ id: `n${ms}`, createdAt: ms === null ? null : { toMillis: () => ms } });

test('clearing hides everything listed and keeps later arrivals', () => {
  const listed = [at(3000), at(1000), at(null)];
  const cutoff = nextClearedBefore(listed, 0);
  assert.equal(cutoff, 3000);
  assert.deepEqual(hideClearedNotifications(listed, cutoff), []);
  const later = [at(3001), ...listed];
  assert.deepEqual(hideClearedNotifications(later, cutoff).map(item => item.id), ['n3001']);
});

test('the cutoff never moves backwards and clears untimestamped legacy items', () => {
  assert.equal(nextClearedBefore([at(500)], 3000), 3000);
  assert.equal(nextClearedBefore([at(null)], 0), 1);
  assert.deepEqual(hideClearedNotifications([at(null)], 1), []);
});

test('nothing is hidden before the first clear or with corrupt browser state', () => {
  for (const raw of [null, '', '[]', 'broken', '-5', 'NaN', 'Infinity']) assert.equal(parseClearedBefore(raw), 0);
  assert.equal(parseClearedBefore('3000'), 3000);
  const listed = [at(1000), at(null)];
  assert.equal(hideClearedNotifications(listed, 0), listed);
});

test('clear state is scoped per account and station', () => {
  assert.notEqual(notificationClearKey('a:station-1'), notificationClearKey('b:station-1'));
  assert.notEqual(notificationClearKey('a:station-1'), notificationClearKey('a:all'));
});

test('map loads with every status except Temporarily Unavailable', () => {
  assert.deepEqual([...DEFAULT_VISIBLE_STATUSES], STATUS_ORDER.filter(status => status !== 'reference'));
  assert.equal(DEFAULT_VISIBLE_STATUSES.includes('reference'), false);
});
