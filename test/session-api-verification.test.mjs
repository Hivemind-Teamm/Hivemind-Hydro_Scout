import test from 'node:test';
import assert from 'node:assert/strict';

const PROJECT = 'demo-hydro-scout-api';
const BASE_URL = 'http://127.0.0.1:3002';

if (
  process.env.GCLOUD_PROJECT !== PROJECT ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
  process.env.NODE_ENV !== 'test' ||
  process.env.TEST_BASE_URL !== BASE_URL
) {
  throw new Error('Exact local emulator configuration required.');
}

async function requestSession(idToken) {
  const response = await fetch(`${BASE_URL}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    redirect: 'manual',
  });

  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get('set-cookie') ?? '',
  };
}

function assertRejected(result) {
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, {
    ok: false,
    error: 'Session verification failed.',
  });

  // Cookie clearing is allowed; issuing a nonempty authenticated
  // session cookie is not.
  const sessionCookie = result.cookie.match(
    /(?:^|,\s*)session=([^;,\s]*)/,
  );

  if (sessionCookie) {
    assert.equal(sessionCookie[1], '');
  }
}

test('malformed nonempty token cannot create a session', async () => {
  assertRejected(await requestSession('not-a-valid-jwt'));
});

test('forged elevated-role JWT cannot create a session', async () => {
  const encode = value =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  const fakeToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      iss: `https://securetoken.google.com/${PROJECT}`,
      aud: PROJECT,
      sub: 'forged-admin',
      user_id: 'forged-admin',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }),
    'invalid-signature',
  ].join('.');

  assertRejected(await requestSession(fakeToken));
});