import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOCATION_NOTICE_VERSION,
  consentMatchesGovernance,
} from '../lib/location-consent.ts';

const granted = {
  version: LOCATION_NOTICE_VERSION,
  uid: 'responder-1',
  stationId: 'STATION-1',
  decision: 'granted',
  decidedAt: 1000,
  governanceRevision: 'revision-A',
};

test('matching governance revision authorizes acknowledged consent', () => {
  assert.equal(
    consentMatchesGovernance(granted, 'revision-A'),
    true,
  );
});

test('changed governance revision invalidates previous consent', () => {
  assert.equal(
    consentMatchesGovernance(granted, 'revision-B'),
    false,
  );
});

test('unverified governance revision cannot authorize sharing', () => {
  assert.equal(consentMatchesGovernance(granted, null), false);
  assert.equal(consentMatchesGovernance(granted, ''), false);
});

test('legacy consent records cannot authorize a new revision', () => {
  const { governanceRevision, ...legacy } = granted;
  assert.equal(governanceRevision, 'revision-A');
  assert.equal(
    consentMatchesGovernance(legacy, 'revision-A'),
    false,
  );
});

test('declined or missing consent never authorizes sharing', () => {
  assert.equal(
    consentMatchesGovernance(
      { ...granted, decision: 'declined' },
      'revision-A',
    ),
    false,
  );

  assert.equal(
    consentMatchesGovernance(null, 'revision-A'),
    false,
  );
});

test('older notice versions do not authorize sharing', () => {
  assert.equal(
    consentMatchesGovernance(
      { ...granted, version: 'old-notice' },
      'revision-A',
    ),
    false,
  );
});
