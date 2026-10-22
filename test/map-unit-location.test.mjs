import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapUnitLocation } from '../lib/map-unit-location.ts';

const uuid = '550e8400-e29b-41d4-a716-446655440000';
const id = `sub-1_${uuid}`;

const position = {
  stationId: 'station-1',
  updatedBy: 'sub-1',
  incidentId: 'fire-1',
  location: { latitude: 14.65, longitude: 121.06 },
  accuracy: 8,
  updatedAt: { toMillis: () => 1_700_000_000_000 },
};

test('maps an incident-linked device location', () => {
  assert.deepEqual(mapUnitLocation(id, position), {
    id,
    stationId: 'station-1',
    incidentId: 'fire-1',
    lat: 14.65,
    lng: 121.06,
    accuracy: 8,
    updatedAt: 1_700_000_000_000,
  });
});

test('accepts zero coordinates and a pending server timestamp', () => {
  const result = mapUnitLocation(id, {
    ...position,
    location: { latitude: 0, longitude: 0 },
    updatedAt: null,
  });

  assert.equal(result?.lat, 0);
  assert.equal(result?.lng, 0);
  assert.equal(result?.updatedAt, null);
});

test('rejects forged or malformed device identities', () => {
  for (const documentId of [
    'station-1',
    'sub-2_' + uuid,
    'sub-1_fire-1',
    'sub-1_not-a-uuid',
  ]) {
    assert.equal(mapUnitLocation(documentId, position), null);
  }

  assert.equal(
    mapUnitLocation(id, { ...position, updatedBy: 'another-user' }),
    null,
  );
});

test('rejects invalid incidents, stations, coordinates and accuracy', () => {
  const invalid = [
    { stationId: 'bad/station' },
    { incidentId: 'bad/incident' },
    { accuracy: -1 },
    { accuracy: 51 },
    { accuracy: Infinity },
    { location: null },
    { location: { latitude: 91, longitude: 121 } },
    { location: { latitude: 14, longitude: -181 } },
    { location: { latitude: NaN, longitude: 121 } },
    { location: { latitude: '14.65', longitude: 121 } },
  ];

  for (const change of invalid) {
    assert.equal(mapUnitLocation(id, { ...position, ...change }), null);
  }
});
