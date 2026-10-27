import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firePinArrivalTracker } from '../lib/fire-pin-arrivals.ts';
const pin = (id, pending = false) => ({ id, pending });

test('existing cached/server pins are a silent baseline; new remote pins alert once', () => {
  const track = firePinArrivalTracker();
  const local = new Set();
  assert.deepEqual(track([pin('old')], true, local), []);
  assert.deepEqual(track([pin('old'), pin('other-existing')], false, local), []);
  assert.deepEqual(track([pin('old'), pin('other-existing'), pin('new')], false, local), ['new']);
  assert.deepEqual(track([pin('old'), pin('other-existing'), pin('new')], false, local), []);
});
test('own creations, local pending writes and movement never replay an alert', () => {
  const track = firePinArrivalTracker();
  const local = new Set(['mine']);
  track([], false, local);
  assert.deepEqual(track([pin('mine')], false, local), []);
  assert.deepEqual(track([pin('mine'), pin('pending', true)], false, local), []);
  assert.deepEqual(track([pin('mine'), pin('pending')], false, local), []);
  assert.deepEqual(track([pin('mine'), pin('pending')], false, local), []);
});
test('cached arrivals wait for server confirmation; reconnects do not replay known IDs', () => {
  const track = firePinArrivalTracker();
  const local = new Set();
  track([pin('old')], false, local);
  assert.deepEqual(track([pin('old'), pin('new')], true, local), []);
  assert.deepEqual(track([pin('old'), pin('new')], false, local), ['new']);
  assert.deepEqual(track([], false, local), []);
  assert.deepEqual(track([pin('old'), pin('new')], false, local), []);
});
test('several new pins in one snapshot are returned as one alert batch', () => {
  const track = firePinArrivalTracker();
  track([], false, new Set());
  assert.deepEqual(track([pin('a'), pin('b')], false, new Set()), ['a', 'b']);
});
