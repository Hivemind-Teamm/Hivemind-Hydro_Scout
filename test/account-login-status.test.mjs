import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountLoginStatus, lastLoggedInLabel } from '../lib/account-login-status.ts';

const now = Date.parse('2026-10-26T04:00:00Z');
test('explicit last login date uses Philippine time across midnight', () => {
  const label = lastLoggedInLabel(new Date('2026-10-25T16:30:00Z'));
  assert.match(label, /^Last logged in /);
  assert.match(label, /26/);
  assert.match(label, /2026/);
  assert.match(label, /PHT/);
  assert.equal(lastLoggedInLabel(null), 'Never logged in');
});
test('login date alone never claims that an account is currently active', () => {
  const date = new Date(now);
  assert.match(accountLoginStatus(date, now).label, /^Last logged in /);
  assert.equal(Object.hasOwn(accountLoginStatus(date, now), 'active'), false);
});
test('relative labels describe login time, never live online presence', () => {
  assert.equal(accountLoginStatus(new Date(now), now).lastLoginLabel, 'Just now');
  assert.equal(accountLoginStatus(new Date(now - 5 * 60_000), now).lastLoginLabel, '5 min ago');
  assert.equal(accountLoginStatus(new Date(now - 2 * 86_400_000), now).lastLoginLabel, '2 days ago');
  assert.match(accountLoginStatus(new Date(now - 2 * 86_400_000), now).label, /^Last logged in /);
});
test('missing, malformed or implausible future login times do not show active', () => {
  assert.equal(accountLoginStatus(null, now).label, 'Never logged in');
  for (const date of ['invalid', new Date(NaN), { toDate: () => 'invalid' }, { toDate: () => { throw new Error('bad'); } }, new Date(now + 86_400_000)]) {
    assert.notEqual(accountLoginStatus(date, now).label, 'Active now');
  }
});
test('Firestore timestamps, dates and historical ISO values agree', () => {
  const date = new Date(now - 60_000);
  assert.deepEqual(accountLoginStatus({ toDate: () => date }, now), accountLoginStatus(date, now));
  assert.deepEqual(accountLoginStatus(date.toISOString(), now), accountLoginStatus(date, now));
});
