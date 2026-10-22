import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupIncidentLocationBeforeLogout,
} from '../lib/incident-logout-cleanup.mjs';
import {
  createIncidentLocationCleanupRegistry,
} from '../lib/incident-location-cleanup-registry.mjs';

const UID = 'station-user-001';

function options(overrides = {}) {
  return {
    uid: UID,
    registry: createIncidentLocationCleanupRegistry(),
    getExistingDeviceId: () => null,
    deleteDeviceLocation: async () => {},
    ...overrides,
  };
}

test('ordinary logout does not create a device identity or delete', async () => {
  let deletions = 0;
  const context = options({
    deleteDeviceLocation: async () => { deletions++; },
  });

  await cleanupIncidentLocationBeforeLogout(context);

  assert.equal(deletions, 0);
});

test('reload cleanup deletes an existing device location', async () => {
  const operations = [];

  await cleanupIncidentLocationBeforeLogout(options({
    getExistingDeviceId: () =>
      '550e8400-e29b-41d4-a716-446655440000',
    deleteDeviceLocation: async uid => {
      operations.push(`delete:${uid}`);
    },
  }));

  assert.deepEqual(operations, [`delete:${UID}`]);
});

test('active controller completes before fallback document deletion', async () => {
  const registry = createIncidentLocationCleanupRegistry();
  const operations = [];
  let releaseCleanup;

  const gate = new Promise(resolve => {
    releaseCleanup = resolve;
  });

  registry.register(UID, async () => {
    operations.push('stop-controller');
    await gate;
    operations.push('controller-cleanup-complete');
  });

  const task = cleanupIncidentLocationBeforeLogout(options({
    registry,
    getExistingDeviceId: () =>
      '550e8400-e29b-41d4-a716-446655440000',
    deleteDeviceLocation: async () => {
      operations.push('fallback-delete');
    },
  }));

  try {
    await Promise.resolve();
    assert.deepEqual(operations, ['stop-controller']);
  } finally {
    releaseCleanup();
  }

  await task;

  assert.deepEqual(operations, [
    'stop-controller',
    'controller-cleanup-complete',
    'fallback-delete',
  ]);
});

test('failed controller cleanup prevents continuing to fallback', async () => {
  const registry = createIncidentLocationCleanupRegistry();
  let fallbackCalled = false;

  registry.register(UID, async () => {
    throw new Error('controller-delete-failed');
  });

  await assert.rejects(
    cleanupIncidentLocationBeforeLogout(options({
      registry,
      getExistingDeviceId: () => 'existing-id',
      deleteDeviceLocation: async () => {
        fallbackCalled = true;
      },
    })),
    /controller-delete-failed/,
  );

  assert.equal(fallbackCalled, false);
});

test('failed standalone deletion is reported', async () => {
  await assert.rejects(
    cleanupIncidentLocationBeforeLogout(options({
      getExistingDeviceId: () =>
        '550e8400-e29b-41d4-a716-446655440000',
      deleteDeviceLocation: async () => {
        throw new Error('firestore-delete-failed');
      },
    })),
    /firestore-delete-failed/,
  );
});

test('rejects a registry owned by another account', async () => {
  const registry = createIncidentLocationCleanupRegistry();
  registry.register('different-user', async () => {});

  await assert.rejects(
    cleanupIncidentLocationBeforeLogout(options({ registry })),
    /incident-cleanup-session-mismatch/,
  );
});

test('active controller cleanup succeeds without a stored UUID', async () => {
  const registry = createIncidentLocationCleanupRegistry();
  let cleanupCount = 0;

  registry.register(UID, async () => {
    cleanupCount++;
  });

  await cleanupIncidentLocationBeforeLogout(options({ registry }));

  assert.equal(cleanupCount, 1);
});