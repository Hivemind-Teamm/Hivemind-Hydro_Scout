import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isIncidentVerificationFresh,
  MAX_INCIDENT_VERIFICATION_AGE_MS,
} from '../lib/incident-verification-freshness.mjs';

test('recent server verification permits a location decision', () => {
  assert.equal(isIncidentVerificationFresh(100_000, 100_000), true);
  assert.equal(isIncidentVerificationFresh(100_000, 114_999), true);
});

test('verification expires exactly at the 15-second boundary', () => {
  assert.equal(MAX_INCIDENT_VERIFICATION_AGE_MS, 15_000);
  assert.equal(isIncidentVerificationFresh(100_000, 115_000), false);
  assert.equal(isIncidentVerificationFresh(100_000, 200_000), false);
});

test('missing or invalid verification fails closed', () => {
  for (const value of [
    null,
    undefined,
    NaN,
    Infinity,
    -Infinity,
    '100000',
  ]) {
    assert.equal(isIncidentVerificationFresh(value, 110_000), false);
  }
});

test('future-dated verification and clock rollback fail closed', () => {
  assert.equal(isIncidentVerificationFresh(110_001, 110_000), false);
  assert.equal(isIncidentVerificationFresh(100_000, NaN), false);
  assert.equal(isIncidentVerificationFresh(100_000, Infinity), false);
});

test('simulated suspended timer cannot extend verification', () => {
  const lastVerification = 100_000;

  // A simulated browser timer has not fired, but wall-clock time
  // has advanced beyond the authorization deadline.
  const resumedAt = 130_000;

  assert.equal(
    isIncidentVerificationFresh(lastVerification, resumedAt),
    false,
  );
});