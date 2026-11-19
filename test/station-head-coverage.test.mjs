import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countPersonalHeads } from '../lib/station-head-coverage.ts';

const account = (accountType, role, stationId) =>
  ({ accountType, role, stationId });

test('counts assigned personal Heads', () => {
  const accounts = [
    account('person', 'head', 'one'),
    account('person', 'head', 'one'),
    account('person', 'head', 'two'),
  ];

  assert.equal(countPersonalHeads(accounts, 'one'), 2);
  assert.equal(countPersonalHeads(accounts, 'two'), 1);
});

test('does not count shared station logins', () => {
  assert.equal(countPersonalHeads([
    account('station', 'head', 'one'),
  ], 'one'), 0);
});

test('does not count other roles', () => {
  assert.equal(countPersonalHeads([
    account('person', 'authorized', 'one'),
    account('person', 'general', 'one'),
    account('person', 'admin', 'one'),
  ], 'one'), 0);
});

test('does not count Heads from other stations', () => {
  assert.equal(countPersonalHeads([
    account('person', 'head', 'two'),
  ], 'one'), 0);
});

test('handles missing assignments and empty lists', () => {
  assert.equal(countPersonalHeads([], 'one'), 0);
  assert.equal(countPersonalHeads([
    account('person', 'head', null),
  ], 'one'), 0);
});

test('excludes pending and rejected Heads', () => {
  const accounts = [
    { ...account('person', 'head', 'one'), stationMembershipStatus: 'pending' },
    { ...account('person', 'head', 'one'), stationMembershipStatus: 'rejected' },
    { ...account('person', 'head', 'one'), stationMembershipStatus: 'approved' },
  ];

  assert.equal(countPersonalHeads(accounts, 'one'), 1);
});

test('includes legacy assigned Heads', () => {
  const accounts = [
    account('person', 'head', 'one'),
    { ...account('person', 'head', 'one'), stationMembershipStatus: 'none' },
  ];

  assert.equal(countPersonalHeads(accounts, 'one'), 2);
});
