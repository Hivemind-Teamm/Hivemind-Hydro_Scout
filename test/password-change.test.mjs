import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordChangeError, passwordChangeProblem } from '../lib/password-change.ts';

test('the form needs the current password, a long enough new one, a real change and a match', () => {
  assert.match(passwordChangeProblem({ current: '', next: 'secret99', retype: 'secret99' }), /current password/);
  assert.match(passwordChangeProblem({ current: 'old-pass', next: '12345', retype: '12345' }), /at least 6/);
  assert.match(passwordChangeProblem({ current: 'same-pass', next: 'same-pass', retype: 'same-pass' }), /different/);
  assert.match(passwordChangeProblem({ current: 'old-pass', next: 'new-pass1', retype: 'new-pass2' }), /do not match/);
  assert.equal(passwordChangeProblem({ current: 'old-pass', next: 'new-pass1', retype: 'new-pass1' }), null);
});

test('Firebase failures read as sentences, never the bare "Error" the old code showed', () => {
  const firebase = (code, message = `Firebase: Error (${code}).`) => Object.assign(new Error(message), { code });
  assert.equal(passwordChangeError(firebase('auth/invalid-credential')), 'Current password is incorrect.');
  assert.equal(passwordChangeError(firebase('auth/wrong-password')), 'Current password is incorrect.');
  assert.match(passwordChangeError(firebase('auth/too-many-requests')), /Too many attempts/);
  assert.match(passwordChangeError(firebase('auth/requires-recent-login')), /sign in again/);
  assert.equal(
    passwordChangeError(firebase('auth/password-does-not-meet-requirements', 'Firebase: Missing password requirements: [Password must contain an upper case character] (auth/password-does-not-meet-requirements).')),
    'Missing password requirements: [Password must contain an upper case character]',
  );
  assert.equal(passwordChangeError(firebase('auth/internal-error')), "Couldn't change the password (auth/internal-error). Try again.");
  assert.equal(passwordChangeError(new Error('boom')), "Couldn't change the password. Try again.");
  for (const code of ['auth/invalid-credential', 'auth/internal-error']) assert.notEqual(passwordChangeError(firebase(code)), 'Error');
});
