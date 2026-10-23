import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStationAssignedToActiveIncident,
} from '../lib/incident-location-assignment.mjs';

const incident = {
  status: 'active',
  assignedStationIds: ['STATION-001', 'STATION-002'],
};

test('active incident authorizes an explicitly assigned station', () => {
  assert.equal(
    isStationAssignedToActiveIncident(incident, 'STATION-001'),
    true,
  );
});

test('active incident rejects an unassigned station', () => {
  assert.equal(
    isStationAssignedToActiveIncident(incident, 'STATION-003'),
    false,
  );
});

test('resolved and cancelled incidents reject assigned stations', () => {
  for (const status of ['resolved', 'cancelled', 'inactive', null]) {
    assert.equal(
      isStationAssignedToActiveIncident({ ...incident, status }, 'STATION-001'),
      false,
    );
  }
});

test('missing assignment list fails closed', () => {
  assert.equal(
    isStationAssignedToActiveIncident(
      { status: 'active' },
      'STATION-001',
    ),
    false,
  );
});

test('invalid assignment lists fail closed', () => {
  for (const assignedStationIds of [null, {}, 'STATION-001', 123]) {
    assert.equal(
      isStationAssignedToActiveIncident(
        { status: 'active', assignedStationIds },
        'STATION-001',
      ),
      false,
    );
  }
});

test('invalid incident and station identities are rejected', () => {
  for (const invalidIncident of [null, undefined, [], 'active', 123]) {
    assert.equal(
      isStationAssignedToActiveIncident(invalidIncident, 'STATION-001'),
      false,
    );
  }

  for (const stationId of [null, '', 'bad/id', 'x'.repeat(129), 123]) {
    assert.equal(
      isStationAssignedToActiveIncident(incident, stationId),
      false,
    );
  }
});

test('client-style verification flags do not grant assignment', () => {
  assert.equal(
    isStationAssignedToActiveIncident(
      {
        status: 'active',
        jurisdictionVerified: true,
        assignedStationIds: [],
      },
      'STATION-001',
    ),
    false,
  );
});

test('assignment is revoked when station is removed from the list', () => {
  assert.equal(
    isStationAssignedToActiveIncident(incident, 'STATION-001'),
    true,
  );

  assert.equal(
    isStationAssignedToActiveIncident(
      { ...incident, assignedStationIds: ['STATION-002'] },
      'STATION-001',
    ),
    false,
  );
});