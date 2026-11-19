import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADMIN_RESPONSE_STATION_ID,
  consentScopeForResponse,
} from '../lib/unit-location.ts';

test('personal Admin uses SYSTEM_ADMIN consent scope', () => {
  assert.equal(
    consentScopeForResponse({
      accountType: 'person',
      role: 'admin',
      stationId: null,
    }),
    ADMIN_RESPONSE_STATION_ID,
  );

  assert.equal(ADMIN_RESPONSE_STATION_ID, 'SYSTEM_ADMIN');
});

test('legacy Admin station assignment does not change consent scope', () => {
  assert.equal(
    consentScopeForResponse({
      accountType: 'person',
      role: 'admin',
      stationId: 'OLD-STATION',
    }),
    ADMIN_RESPONSE_STATION_ID,
  );
});

test('approved personal responder retains their own station scope', () => {
  assert.equal(
    consentScopeForResponse({
      accountType: 'person',
      role: 'head',
      stationId: 'STATION-1',
      stationMembershipStatus: 'approved',
    }),
    'STATION-1',
  );
});

test('pending or unassigned personal accounts get no response consent scope', () => {
  assert.equal(
    consentScopeForResponse({
      accountType: 'person',
      role: 'authorized',
      stationId: 'STATION-1',
      stationMembershipStatus: 'pending',
    }),
    null,
  );

  assert.equal(
    consentScopeForResponse({
      accountType: 'person',
      role: 'general',
      stationId: null,
      stationMembershipStatus: 'none',
    }),
    null,
  );
});

test('shared station accounts never receive personal Admin consent scope', () => {
  assert.equal(
    consentScopeForResponse({
      accountType: 'station',
      role: 'admin',
      stationId: 'STATION-1',
      stationMembershipStatus: 'approved',
    }),
    null,
  );
});

test('missing and incomplete profiles cannot receive Admin consent scope', () => {
  assert.equal(consentScopeForResponse(undefined), null);
  assert.equal(consentScopeForResponse({ role: 'admin' }), null);
});
