import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationMemberFromProfile, searchStationMembers } from '../lib/station-members.ts';
const source = { accountType: 'person', stationId: 'one', displayName: 'Karl Manangan', role: 'authorized', stationMembershipStatus: 'approved' };
test('roster includes assigned people, including legacy manual assignments, but excludes requests and other stations', () => {
  assert.equal(stationMemberFromProfile('one', source, 'one').name, 'Karl Manangan');
  assert.ok(stationMemberFromProfile('one', { ...source, stationMembershipStatus: undefined }, 'one'));
  for (const patch of [{ stationId: 'two' }, { accountType: 'station' }, { stationMembershipStatus: 'pending' }, { stationMembershipStatus: 'rejected' }, { stationMembershipStatus: 'unknown' }]) {
    assert.equal(stationMemberFromProfile('one', { ...source, ...patch }, 'one'), null);
  }
});
test('search matches names and role labels, without modifying the source list', () => {
  const members = [stationMemberFromProfile('z', { ...source, displayName: 'Zed', role: 'head' }, 'one'), stationMemberFromProfile('a', source, 'one')];
  assert.equal(searchStationMembers(members, 'kArL')[0].uid, 'a');
  assert.equal(searchStationMembers(members, ' HEAD ')[0].uid, 'z');
  assert.deepEqual(searchStationMembers(members, '').map(member => member.uid), ['a', 'z']);
  assert.equal(members[0].uid, 'z');
});
test('invalid display fields and unknown roles have safe fallbacks', () => {
  const member = stationMemberFromProfile('one', { ...source, displayName: 12, role: '__proto__' }, 'one');
  assert.equal(member.name, 'Member');
  assert.equal(member.role, 'Member');
});
