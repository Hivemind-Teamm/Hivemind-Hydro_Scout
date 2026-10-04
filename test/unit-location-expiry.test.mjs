import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_UNIT_LOCATION_TIMEOUT_MS, freshUnitLocations, locationTimeoutMs, watchUnitLocationExpiry,
} from '../lib/unit-location-expiry.ts';

const position = (stationId, updatedAt) => ({ stationId, updatedAt, lat: 14.65, lng: 121.06, accuracy: 8 });

test('uses a configurable timeout with a 15-minute default', () => {
  assert.equal(DEFAULT_UNIT_LOCATION_TIMEOUT_MS, 900_000);
  assert.equal(locationTimeoutMs('5'), 300_000);
  for (const value of [undefined, '', 'bad', '0', '-5', 'Infinity', '1441']) {
    assert.equal(locationTimeoutMs(value), DEFAULT_UNIT_LOCATION_TIMEOUT_MS);
  }
});

test('hides missing, invalid, and expired timestamps at the exact deadline', () => {
  const locations = [position('fresh', 901), position('expired', 900), position('missing', null), position('invalid', NaN)];
  assert.deepEqual(freshUnitLocations(locations, 1000, 100).map(location => location.stationId), ['fresh']);
});

test('expires successive reports without another snapshot', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let visible = [];
  const watcher = watchUnitLocationExpiry(locations => { visible = locations; }, 100);
  watcher.update([position('first', 950), position('second', 980)]);
  assert.equal(visible.length, 2);
  t.mock.timers.tick(50);
  assert.deepEqual(visible.map(location => location.stationId), ['second']);
  t.mock.timers.tick(30);
  assert.equal(visible.length, 0);
  watcher.stop();
});

test('fresh snapshots reset expiry and restore expired icons; deletion cancels expiry', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let visible = [];
  const watcher = watchUnitLocationExpiry(locations => { visible = locations; }, 100);
  watcher.update([position('station', 1000)]);
  t.mock.timers.tick(90);
  watcher.update([position('station', 1090)]);
  t.mock.timers.tick(10);
  assert.equal(visible.length, 1);
  t.mock.timers.tick(90);
  assert.equal(visible.length, 0);
  watcher.update([position('station', 1190)]);
  assert.equal(visible.length, 1);
  watcher.update([]);
  t.mock.timers.tick(100);
  assert.equal(visible.length, 0);
  watcher.stop();
});

test('resume refresh catches delayed expiry and stopped watchers never publish', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let visible = [];
  let calls = 0;
  const watcher = watchUnitLocationExpiry(locations => { visible = locations; calls++; }, 100);
  watcher.update([position('station', 1000)]);
  t.mock.timers.setTime(2000);
  watcher.refresh();
  assert.equal(visible.length, 0);
  watcher.stop();
  const stoppedCalls = calls;
  watcher.update([position('station', 2000)]);
  watcher.refresh();
  t.mock.timers.tick(500);
  assert.equal(calls, stoppedCalls);
});
