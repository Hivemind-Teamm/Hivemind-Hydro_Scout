import test from 'node:test';
import assert from 'node:assert/strict';
import {
  incidentLocationDocumentId,
} from '../lib/incident-location-document-id.mjs';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

test('Accepts a valid UID and device UUID', () => {
  assert.equal(
    incidentLocationDocumentId('stationUser123', UUID),
    `stationUser123_${UUID}`,
  );
});

test('Accepts valid UID separators and uppercase UUID hex', () => {
  const upperUUID = UUID.toUpperCase();

  assert.equal(
    incidentLocationDocumentId('station-user_123', upperUUID),
    `station-user_123_${upperUUID}`,
  );
});

test('Accepts UID boundaries of 1 and 128 characters', () => {
  assert.equal(
    incidentLocationDocumentId('a', UUID),
    `a_${UUID}`,
  );

  const maximumUid = 'a'.repeat(128);

  assert.equal(
    incidentLocationDocumentId(maximumUid, UUID),
    `${maximumUid}_${UUID}`,
  );
});

test('Rejects missing, nonstring, and oversized UIDs', () => {
  for (const uid of [
    '',
    null,
    undefined,
    123,
    {},
    'a'.repeat(129),
  ]) {
    assert.throws(
      () => incidentLocationDocumentId(uid, UUID),
      /invalid-location-identity/,
    );
  }
});

test('Rejects unsafe UID characters and document paths', () => {
  for (const uid of [
    'station/user',
    '../station',
    'station.user',
    'station user',
    'station@user',
    'station\\user',
    'station\nuser',
    'station#user',
  ]) {
    assert.throws(
      () => incidentLocationDocumentId(uid, UUID),
      /invalid-location-identity/,
    );
  }
});

test('Rejects missing or malformed device UUIDs', () => {
  for (const deviceId of [
    '',
    null,
    undefined,
    123,
    'not-a-uuid',
    '123e4567-e89b-02d3-a456-426614174000',
    '123e4567-e89b-42d3-7456-426614174000',
    '123e4567-e89b-42d3-a456-42661417400g',
    `${UUID}/other`,
    `${UUID}extra`,
  ]) {
    assert.throws(
      () => incidentLocationDocumentId('stationUser123', deviceId),
      /invalid-location-identity/,
    );
  }
});

test('Constructs exactly one Firestore document ID segment', () => {
  const id = incidentLocationDocumentId('station_user', UUID);

  assert.equal(id.includes('/'), false);
  assert.equal(id, `station_user_${UUID}`);
  assert.equal(id.endsWith(UUID), true);
});