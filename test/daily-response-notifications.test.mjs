import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyResponseNotifications, unreadActivityCount, stationNotificationCardKey } from '../lib/station-notification-feed.ts';
import { notificationReadKey } from '../lib/notification-read-state.ts';

const stamp = iso => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso) });
const response = (id, uid, name, start = '2026-10-25T01:00:00Z', status = 'active', end) => ({
  id: `${id}_${status}`, type: status === 'active' ? 'response-started' : 'response-ended', uid, displayName: name, responseId: id,
  message: 'Response', createdAt: stamp(end ?? start),
  response: { id, uid, displayName: name, stationId: 'one', status, startedAt: stamp(start), endedAt: end ? stamp(end) : null },
});

test('one/two/many distinct people use the requested title format', () => {
  const a = response('a', 'karl', 'Karl Andrei Manangan');
  const b = response('b', 'mark', 'Mark Barican');
  const c = response('c', 'other', 'Other Person');
  assert.equal(dailyResponseNotifications([a], 'one')[0].message, 'Karl Andrei Manangan started response.');
  assert.equal(dailyResponseNotifications([a, b], 'one')[0].message, 'Karl Andrei Manangan and Mark Barican started response.');
  assert.equal(dailyResponseNotifications([a, b, c], 'one')[0].message, 'Karl Andrei Manangan and 2 others started response.');
});

test('same person repeat responses retain separate entries but count once in the title', () => {
  const grouped = dailyResponseNotifications([response('a', 'karl', 'Karl'), response('b', 'karl', 'Karl')], 'one');
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].responseGroup.entries.length, 2);
  assert.equal(grouped[0].responseGroup.peopleCount, 1);
  assert.equal(grouped[0].message, 'Karl started response.');
});

test('Philippine midnight creates a new group; overnight ends retain their start-day group', () => {
  const before = response('a', 'a', 'A', '2026-10-25T15:59:59Z');
  const after = response('b', 'b', 'B', '2026-10-25T16:00:00Z');
  const groups = dailyResponseNotifications([before, after], 'one');
  assert.deepEqual(groups.map(item => item.responseGroup.day).sort(), ['2026-10-25', '2026-10-26']);
  const ended = response('a', 'a', 'A', '2026-10-25T15:59:59Z', 'ended', '2026-10-25T17:00:00Z');
  const [original] = dailyResponseNotifications([before], 'one');
  const [updated] = dailyResponseNotifications([ended], 'one');
  assert.equal(stationNotificationCardKey(original), stationNotificationCardKey(updated));
  assert.equal(updated.responseGroup.day, '2026-10-25');
  assert.equal(updated.responseGroup.activeCount, 0);
  assert.equal(updated.message, 'A ended response.');
});

test('mixed response status has an accurate title and stays active until the last response ends', () => {
  const [group] = dailyResponseNotifications([response('a', 'a', 'A'), response('b', 'b', 'B', undefined, 'ended', '2026-10-25T02:00:00Z')], 'one');
  assert.equal(group.message, 'A and B updated their response status.');
  assert.equal(group.responseGroup.activeCount, 1);
});

test('badges count unread entries and decrease individually; ending a read response reopens only that entry', () => {
  const a = response('a', 'a', 'A');
  const b = response('b', 'b', 'B');
  const read = new Set();
  const key = item => notificationReadKey('activity', item.id, item.createdAt);
  const unread = item => !read.has(key(item));
  const [group] = dailyResponseNotifications([a, b], 'one');
  assert.equal(unreadActivityCount(group, unread), 2);
  read.add(key(a));
  assert.equal(unreadActivityCount(group, unread), 1);
  read.add(key(b));
  assert.equal(unreadActivityCount(group, unread), 0);
  const ending = response('a', 'a', 'A', undefined, 'ended', '2026-10-25T02:00:00Z');
  const [updated] = dailyResponseNotifications([ending, b], 'one');
  assert.equal(unreadActivityCount(updated, unread), 1);
  // Restored receipt state has the same count; grouping never creates new read IDs.
  const relogged = new Set(read);
  assert.equal(unreadActivityCount(updated, item => !relogged.has(key(item))), 1);
});

test('station boundaries, unrelated events and identity-free limited summaries stay separate', () => {
  const a = response('a', 'secret-a', 'PRIVATE');
  const b = response('b', 'secret-b', 'PRIVATE');
  b.response.stationId = 'two';
  assert.equal(dailyResponseNotifications([a, b], null).length, 2);
  const notice = { id: 'fire', type: 'fire-pinned', message: 'Fire' };
  assert.ok(dailyResponseNotifications([a, notice], 'one').includes(notice));
  const limited = { ...a, uid: undefined, displayName: undefined, limited: true,
    response: { ...a.response, uid: '', displayName: '', stationId: '' } };
  const [group] = dailyResponseNotifications([limited], 'one');
  assert.equal(group.message.includes('PRIVATE'), false);
  assert.equal(group.responseGroup.entries[0].uid, undefined);
});

test('missing timestamps do not invent a daily group or lose the response', () => {
  const source = response('a', 'a', 'A');
  source.createdAt = null;
  source.response.startedAt = null;
  assert.deepEqual(dailyResponseNotifications([source], 'one'), [source]);
});
