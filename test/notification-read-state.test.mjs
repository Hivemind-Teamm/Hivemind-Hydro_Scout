import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationReadKey, parseReadNotifications } from '../lib/notification-read-state.ts';

const timestamp = ms => ({ toDate: () => new Date(ms) });

test('reading one activity leaves the rest unread, including member requests', () => {
  const first = notificationReadKey('activity', 'one', timestamp(1000));
  const second = notificationReadKey('activity', 'two', timestamp(2000));
  const member = notificationReadKey('member', 'one', timestamp(1000));
  const read = new Set(parseReadNotifications(JSON.stringify([first])));
  assert.equal(read.has(first), true);
  assert.equal(read.has(second), false);
  assert.equal(read.has(member), false);
  assert.equal([first, second].some(key => !read.has(key)), true);
  read.add(second);
  assert.equal([first, second].some(key => !read.has(key)), false);
});

test('a reused notification document becomes unread when its event timestamp changes', () => {
  const previous = notificationReadKey('activity', 'membership-approved', timestamp(1000));
  const next = notificationReadKey('activity', 'membership-approved', timestamp(2000));
  assert.notEqual(previous, next);
  assert.equal(new Set([previous]).has(next), false);
});

test('invalid browser state does not mark notifications read', () => {
  for (const raw of [null, 'broken', '{}', 'null', '42']) assert.deepEqual(parseReadNotifications(raw), []);
  assert.deepEqual(parseReadNotifications('["read", false, 7, null]'), ['read']);
});
