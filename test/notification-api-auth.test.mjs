import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
test('limited notifications reject anonymous reads, including requested foreign scopes', async () => {
  const response = await fetch(`${base}/api/notifications?stationId=foreign&uid=other`);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('limited notifications reject forged sessions', async () => {
  const response = await fetch(`${base}/api/notifications`, { headers: { Cookie: 'session=forged.invalid.session' } });
  assert.equal(response.status, 401);
});
test('notification receipts reject cross-origin and anonymous writes', async () => {
  const post = origin => fetch(`${base}/api/notifications`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'a'.repeat(64), uid: 'other' }),
  });
  assert.equal((await post('https://foreign.example')).status, 403);
  assert.equal((await post(base)).status, 401);
});
