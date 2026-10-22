import assert from 'node:assert/strict';
import test from 'node:test';
import { stationIdForLocation } from '../lib/station-location-identity.ts';

test('accepts explicitly marked station accounts with valid IDs', () => {
  assert.equal(
    stationIdForLocation({
      accountType: 'station',
      stationId: 'QCFD-STATION-01',
    }),
    'QCFD-STATION-01',
  );
});

test('rejects accounts without an explicit station identity', () => {
  for (const profile of [
    undefined,
    {},
    { stationId: 'station-1' },
    { accountType: 'person', stationId: 'station-1' },
    { accountType: 'firefighter', stationId: 'station-1' },
  ]) {
    assert.equal(stationIdForLocation(profile), null);
  }
});

test('rejects malformed station IDs', () => {
  for (const stationId of [
    undefined,
    null,
    '',
    ' ',
    'station/1',
    'a'.repeat(129),
    123,
  ]) {
    assert.equal(
      stationIdForLocation({
        accountType: 'station',
        stationId,
      }),
      null,
    );
  }
});
