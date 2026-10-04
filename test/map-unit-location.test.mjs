import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapUnitLocation } from '../lib/map-unit-location.ts';

const position = { stationId: 'station-1', lat: 14.65, lng: 121.06, accuracy: 8,
  updatedAt: { toMillis: () => 1_700_000_000_000 } };

test('maps valid positions and report times, including zero coordinates', () => {
  assert.deepEqual(mapUnitLocation('station-1', position), {
    stationId: 'station-1', lat: 14.65, lng: 121.06, accuracy: 8, updatedAt: 1_700_000_000_000,
  });
  assert.equal(mapUnitLocation('station-1', { ...position, lat: 0, lng: 0, updatedAt: null }).updatedAt, null);
});

test('rejects malformed, mismatched, and out-of-range map records', () => {
  for (const change of [
    { stationId: 'other' }, { lat: NaN }, { lat: 91 }, { lng: Infinity },
    { lng: -181 }, { lat: '14.65' }, { accuracy: -1 }, { accuracy: 40_075_001 },
  ]) assert.equal(mapUnitLocation('station-1', { ...position, ...change }), null);
  assert.equal(mapUnitLocation('bad/id', { ...position, stationId: 'bad/id' }), null);
});
