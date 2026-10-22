import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapUnitLocation } from '../lib/map-unit-location.ts';

const position = { stationId: 'station-1', lat: 14.65, lng: 121.06, accuracy: 8,
  updatedAt: { toMillis: () => 1_700_000_000_000 } };

test('maps valid positions and report times, including zero coordinates', () => {
  assert.deepEqual(mapUnitLocation('station-1', position), {
    id: 'station-1', stationId: 'station-1', lat: 14.65, lng: 121.06, accuracy: 8, updatedAt: 1_700_000_000_000,
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

test('separate device reports retain their station label and unique identity', () => {
  const deviceId = '11111111-1111-4111-8111-111111111111';
  const data = { ...position, deviceId, updatedBy: 'account-1' };
  const first = mapUnitLocation('account-1_' + deviceId, data);
  const secondId = '22222222-2222-4222-8222-222222222222';
  const second = mapUnitLocation('account-1_' + secondId, { ...data, deviceId: secondId });
  assert.equal(first.stationId, second.stationId);
  assert.notEqual(first.id, second.id);
  assert.equal(mapUnitLocation('other_' + deviceId, data), null);
});

test('maps station-labeled active responses without exposing responder identifiers', () => {
  const responseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const report = mapUnitLocation(responseId, {
    responseId,
    stationId: 'station-1',
    stationName: 'Diliman Fire Station',
    public: true,
    lat: 14.65,
    lng: 121.06,
    accuracy: 7,
    updatedAt: { toMillis: () => 1_700_000_000_000 },
  });
  assert.deepEqual(report, {
    id: responseId,
    stationId: 'station-1',
    stationName: 'Diliman Fire Station',
    lat: 14.65,
    lng: 121.06,
    accuracy: 7,
    updatedAt: 1_700_000_000_000,
  });
  assert.equal(mapUnitLocation(responseId, {
    responseId,
    stationId: 'station-1',
    stationName: '',
    public: true,
    lat: 14.65,
    lng: 121.06,
    accuracy: 7,
  }), null);
  assert.equal(mapUnitLocation(responseId, {
    responseId,
    stationId: 'station-1',
    stationName: 'Diliman Fire Station',
    lat: 14.65,
    lng: 121.06,
    accuracy: 7,
  }), null);
});
