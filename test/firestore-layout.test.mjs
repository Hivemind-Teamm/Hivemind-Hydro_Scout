import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRE_INCIDENT_ID_PATTERN, newFireIncidentId, stationRecordPath } from '../lib/firestore-layout.mjs';

test('station records are nested under a validated station', () => {
  assert.equal(stationRecordPath('DILIMAN-01', 'responses', 'response-1'), 'stations/DILIMAN-01/responses/response-1');
  assert.equal(stationRecordPath('DILIMAN-01', 'joinRequests', 'member'), 'stations/DILIMAN-01/joinRequests/member');
  assert.throws(() => stationRecordPath('../other', 'responses', 'response-1'));
  assert.throws(() => stationRecordPath('DILIMAN-01', 'unknown', 'response-1'));
  assert.throws(() => stationRecordPath('DILIMAN-01', 'responses', '../response-1'));
});

test('new fire incident IDs use the Philippine calendar date and accepted format', () => {
  const id = newFireIncidentId(new Date('2026-10-25T16:30:00.000Z'), '01234567-89ab-cdef-0123-456789abcdef');
  assert.equal(id, 'FIRE-20261026-0123456789abcdef');
  assert.match(id, FIRE_INCIDENT_ID_PATTERN);
  assert.match('abcdefghijklmnopqrst', FIRE_INCIDENT_ID_PATTERN);
  assert.doesNotMatch('fire-20261026-0123456789abcdef', FIRE_INCIDENT_ID_PATTERN);
});
