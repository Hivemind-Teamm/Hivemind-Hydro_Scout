import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIncidentLocationCleanupRegistry,
} from '../lib/incident-location-cleanup-registry.mjs';

const UID = 'station-user-001';

test('Registered owner can complete cleanup', async () => {
  const registry = createIncidentLocationCleanupRegistry();
  let cleanupCount = 0;

  const unregister = registry.register(UID, async () => {
    cleanupCount++;
  });

  assert.equal(registry.registeredUid, UID);

  await registry.cleanup(UID);

  assert.equal(cleanupCount, 1);

  unregister();

  assert.equal(registry.registeredUid, null);
});

test('Cleanup waits for an unfinished deletion', async () => {
  const registry = createIncidentLocationCleanupRegistry();

  let finishDeletion;
  const deletionGate = new Promise(resolve => {
    finishDeletion = resolve;
  });

  const operations = [];
  let completed = false;

  registry.register(UID, async () => {
    operations.push('delete-start');
    await deletionGate;
    operations.push('delete-finished');
  });

  const pendingCleanup = registry.cleanup(UID).then(() => {
    completed = true;
  });

  try {
    await Promise.resolve();

    assert.equal(completed, false);
    assert.deepEqual(operations, ['delete-start']);
  } finally {
    finishDeletion();
  }

  await pendingCleanup;

  assert.equal(completed, true);
  assert.deepEqual(
    operations,
    ['delete-start', 'delete-finished'],
  );
});

test('Cleanup failure propagates to the caller', async () => {
  const registry = createIncidentLocationCleanupRegistry();

  registry.register(UID, async () => {
    throw new Error('Simulated Firestore deletion failure');
  });

  await assert.rejects(
    registry.cleanup(UID),
    /Simulated Firestore deletion failure/,
  );

  // A failed cleanup does not silently unregister its owner.
  assert.equal(registry.registeredUid, UID);
});

test('Rejects missing and mismatched cleanup identities', async () => {
  const registry = createIncidentLocationCleanupRegistry();
  let cleanupCount = 0;

  await assert.rejects(
    registry.cleanup(UID),
    /incident-cleanup-unavailable/,
  );

  registry.register(UID, async () => {
    cleanupCount++;
  });

  await assert.rejects(
    registry.cleanup('different-user'),
    /incident-cleanup-unavailable/,
  );

  for (const invalidUid of ['', 'bad/user', 'bad.user']) {
    await assert.rejects(
      registry.cleanup(invalidUid),
      /invalid-cleanup-identity/,
    );
  }

  assert.equal(cleanupCount, 0);
});

test('Rejects duplicate registration and protects newer sessions', async () => {
  const registry = createIncidentLocationCleanupRegistry();
  let firstCount = 0;
  let secondCount = 0;

  const unregisterFirst = registry.register(UID, async () => {
    firstCount++;
  });

  assert.throws(
    () => registry.register(UID, async () => {}),
    /cleanup-already-registered/,
  );

  assert.throws(
    () => registry.register('different-user', async () => {}),
    /cleanup-already-registered/,
  );

  unregisterFirst();

  const unregisterSecond = registry.register(UID, async () => {
    secondCount++;
  });

  // Cleanup from the old component must not remove the new one.
  unregisterFirst();

  await registry.cleanup(UID);

  assert.equal(firstCount, 0);
  assert.equal(secondCount, 1);

  unregisterSecond();

  await assert.rejects(
    registry.cleanup(UID),
    /incident-cleanup-unavailable/,
  );
});