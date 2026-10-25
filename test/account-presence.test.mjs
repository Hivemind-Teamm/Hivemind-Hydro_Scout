import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountIsPresent, PRESENCE_EXPIRY_MS, presenceSession } from '../lib/account-presence-state.ts';

const seen = milliseconds => ({ toMillis: () => milliseconds });
test('fresh authenticated presence expires at the timeout, not at the last-login date', () => {
  const records = [{ uid: 'one', lastSeenAt: seen(1000) }];
  assert.equal(accountIsPresent(records, 'one', 1000), true);
  assert.equal(accountIsPresent(records, 'one', 1000 + PRESENCE_EXPIRY_MS - 1), true);
  assert.equal(accountIsPresent(records, 'one', 1000 + PRESENCE_EXPIRY_MS), false);
  assert.equal(accountIsPresent(records, 'other', 1000), false);
});
test('another live tab/device keeps the account online after one session closes', () => {
  const now = 1_000_000;
  const stale = { uid: 'one', lastSeenAt: seen(now - PRESENCE_EXPIRY_MS) };
  const a = { uid: 'one', lastSeenAt: seen(now) };
  const b = { uid: 'one', lastSeenAt: seen(now - 1000) };
  assert.equal(accountIsPresent([stale, a, b], 'one', now), true);
  assert.equal(accountIsPresent([stale, b], 'one', now), true);
  assert.equal(accountIsPresent([stale], 'one', now), false);
});
test('missing, nonfinite and implausibly future timestamps cannot indicate active', () => {
  for (const lastSeenAt of [undefined, null, seen(NaN), seen(Infinity), seen(1_000_000)]) {
    assert.equal(accountIsPresent([{ uid: 'one', lastSeenAt }], 'one', 1000), false);
  }
});
test('logout waits for an in-flight heartbeat then deletes, without recreating presence', async () => {
  const events = [];
  let finish;
  const writer = presenceSession(() => { events.push('write'); return new Promise(resolve => { finish = resolve; }); }, async () => { events.push('remove'); });
  const heartbeat = writer.heartbeat();
  await Promise.resolve();
  assert.equal(writer.heartbeat(), heartbeat);
  const stop = writer.stop();
  finish();
  await stop;
  await writer.heartbeat();
  await writer.stop();
  assert.deepEqual(events, ['write', 'remove']);
});
test('cleanup before the queued first heartbeat prevents its write', async () => {
  const events = [];
  const writer = presenceSession(async () => events.push('write'), async () => events.push('remove'));
  const heartbeat = writer.heartbeat();
  await writer.stop();
  await heartbeat;
  assert.deepEqual(events, ['remove']);
});
test('a failed heartbeat does not prevent cleanup', async () => {
  let removed = false;
  const writer = presenceSession(async () => { throw new Error('offline'); }, async () => { removed = true; });
  await assert.rejects(writer.heartbeat());
  await writer.stop();
  assert.equal(removed, true);
});
