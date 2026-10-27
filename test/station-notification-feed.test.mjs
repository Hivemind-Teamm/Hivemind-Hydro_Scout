import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stationNotificationFeed, stationNotificationCardKey, responseDuration } from '../lib/station-notification-feed.ts';
import { notificationReadKey } from '../lib/notification-read-state.ts';

const stamp = milliseconds => ({ toMillis: () => milliseconds, toDate: () => new Date(milliseconds) });
const start = { id: 'r1_start', responseId: 'r1', type: 'response-started', uid: 'responder', displayName: 'Responder One', message: 'Started', createdAt: stamp(1000) };
const end = { ...start, id: 'r1_end', type: 'response-ended', message: 'Ended', createdAt: stamp(61000) };
const record = { id: 'r1', uid: 'responder', displayName: 'Responder One', stationId: 'station-one', stationName: 'Station One', status: 'active', startedAt: stamp(1000), endedAt: null };

test('response history retains fire coordinates and incident link after clearing', () => {
  const [item] = stationNotificationFeed([start, end], [{ ...record, status: 'ended', firePinId: 'fire-one', incidentLat: 14.65, incidentLng: 121.06, endReason: 'incident-cleared' }]);
  assert.equal(item.response.firePinId, 'fire-one');
  assert.equal(item.response.incidentLat, 14.65);
  assert.equal(item.response.incidentLng, 121.06);
  assert.equal(item.response.endReason, 'incident-cleared');
});

test('start and end update one stable response card with authoritative timestamps', () => {
  const [active] = stationNotificationFeed([start], [record]);
  const endedRecord = { ...record, status: 'ended', endedAt: stamp(61000), endedByUid: 'responder' };
  const ended = stationNotificationFeed([start, end], [endedRecord]);
  assert.equal(ended.length, 1);
  assert.equal(active.message, 'Responder One started response.');
  assert.equal(active.response.status, 'active');
  assert.equal(ended[0].message, 'Responder One ended response.');
  assert.equal(ended[0].response.status, 'ended');
  assert.equal(ended[0].response.startedAt.toMillis(), 1000);
  assert.equal(ended[0].response.endedAt.toMillis(), 61000);
  assert.equal(stationNotificationCardKey(active), stationNotificationCardKey(ended[0]));
});

test('ending an already-read response becomes unread without creating a second card', () => {
  const [active] = stationNotificationFeed([start], [record]);
  const read = new Set([notificationReadKey('activity', active.id, active.createdAt)]);
  const ended = stationNotificationFeed([end, start], [{ ...record, status: 'ended', endedAt: end.createdAt }]);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].id, 'r1_end'); // Persist receipts against the real immutable source event.
  assert.equal(ended.some(item => !read.has(notificationReadKey('activity', item.id, item.createdAt))), true);
  read.add(notificationReadKey('activity', ended[0].id, ended[0].createdAt));
  assert.equal(ended.some(item => !read.has(notificationReadKey('activity', item.id, item.createdAt))), false);
});

test('management closure keeps the responder identity and clears active status', () => {
  const closed = { ...end, id: 'r1_closed', type: 'station-response-closed', uid: 'head', displayName: 'Station Head' };
  const [card] = stationNotificationFeed([start, closed], []);
  assert.equal(card.response.status, 'ended');
  assert.equal(card.uid, 'responder');
  assert.equal(card.displayName, 'Responder One');
  assert.equal(card.response.endedByUid, 'head');
  assert.equal(card.response.endReason, 'station-head');
});

test('response updates reconcile before the terminal event arrives; old event-only history still combines', () => {
  const [card] = stationNotificationFeed([start], [{ ...record, status: 'ended', endedAt: end.createdAt }]);
  assert.equal(card.response.status, 'ended');
  assert.equal(card.message, 'Responder One ended response.');
  const history = stationNotificationFeed([start, end], []);
  assert.equal(history.length, 1);
  assert.equal(responseDuration(history[0].response, 999999), '1 min 0 sec');
});

test('different responses from the same person and unrelated notifications remain distinct', () => {
  const another = { ...start, id: 'r2_start', responseId: 'r2', createdAt: stamp(100000) };
  const assignment = { id: 'assignment', type: 'personal-station-assigned', message: 'Assigned', createdAt: stamp(200000) };
  const feed = stationNotificationFeed([start, end, another, assignment], []);
  assert.equal(feed.length, 3);
  assert.equal(feed[0].id, 'assignment');
  assert.equal(feed[1].responseId, 'r2');
  assert.equal(feed[2].responseId, 'r1');
});

test('GPS heartbeats do not revive unread dots or replace the start timestamp', () => {
  const [original] = stationNotificationFeed([start], [record]);
  const [updated] = stationNotificationFeed([start], [{ ...record, lastLocationAt: stamp(50000) }]);
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.response.startedAt, original.response.startedAt);
  assert.equal(updated.response.lastLocationAt.toMillis(), 50000);
});

test('duration ticks while active and stops at the end time without inventing missing times', () => {
  assert.equal(responseDuration(record, 2000), '0 min 1 sec');
  assert.equal(responseDuration(record, 62000), '1 min 1 sec');
  assert.equal(responseDuration({ ...record, status: 'ended', endedAt: stamp(62000) }, 100000), '1 min 1 sec');
  assert.equal(responseDuration({ ...record, status: 'ended', endedAt: null }, 100000), 'Not recorded');
  assert.equal(responseDuration({ ...record, startedAt: null }, 100000), 'Not recorded');
});
