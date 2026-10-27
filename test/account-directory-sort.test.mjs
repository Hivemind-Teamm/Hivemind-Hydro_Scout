import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortAccountDirectory } from '../lib/account-directory-sort.ts';
const account = (uid, role, accountType = 'person', extra = {}) => ({ uid, displayName: uid, role, accountType, ...extra });
const ids = accounts => accounts.map(item => item.uid);
test('access tiers sort both ways, with fixed station accounts at head-equivalent access', () => {
  const users = [account('admin', 'admin'), account('station', null, 'station'), account('general', 'general'), account('head', 'head'), account('authorized', 'authorized')];
  assert.deepEqual(ids(sortAccountDirectory(users, 'tier-asc')), ['general', 'authorized', 'head', 'station', 'admin']);
  assert.deepEqual(ids(sortAccountDirectory(users, 'tier-desc')), ['admin', 'head', 'station', 'authorized', 'general']);
  assert.equal(users[0].uid, 'admin');
});
test('last-login and creation sorts use their own timestamps and put missing/invalid dates last', () => {
  const users = [account('older', 'head', 'person', { lastLoginAt: new Date(1000), createdAt: new Date(3000) }),
    account('newer', 'general', 'person', { lastLoginAt: new Date(2000), createdAt: new Date(2000) }),
    account('missing', 'admin'), account('invalid', 'admin', 'person', { lastLoginAt: new Date(NaN) })];
  assert.deepEqual(ids(sortAccountDirectory(users, 'last-login')), ['newer', 'older', 'invalid', 'missing']);
  assert.deepEqual(ids(sortAccountDirectory(users, 'created')), ['older', 'newer', 'invalid', 'missing']);
});
test('unknown tiers remain last and ties use stable name/UID ordering', () => {
  const users = [account('unknown', '__proto__'), account('b', 'head', 'person', { displayName: 'Same' }), account('a', 'head', 'person', { displayName: 'Same' })];
  assert.deepEqual(ids(sortAccountDirectory(users, 'tier-asc')), ['a', 'b', 'unknown']);
  assert.deepEqual(ids(sortAccountDirectory(users, 'tier-desc')), ['a', 'b', 'unknown']);
});
test('name sorting supports both directions after existing filters', () => {
  const users = [account('B', 'head'), account('A', 'admin')];
  assert.deepEqual(ids(sortAccountDirectory(users, 'name-asc')), ['A', 'B']);
  assert.deepEqual(ids(sortAccountDirectory(users, 'name-desc')), ['B', 'A']);
});
