import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function compile(relativePath) {
  const source = fs.readFileSync(
    new URL(relativePath, import.meta.url),
    'utf8',
  );
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
}

function load(source, resolveImport = () => {
  throw new Error('Unexpected import');
}) {
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: resolveImport,
  });
  return module.exports;
}

const settings = load(compile('../lib/incident-location-settings.mjs'));

const algorithm = load(
  compile('../lib/incident-location-algorithm.ts'),
  name => {
    assert.equal(name, './incident-location-config');
    return settings;
  },
);

const { createIncidentLocationController } = load(
  compile('../lib/incident-location-controller.ts'),
  name => {
    if (name === './incident-location-algorithm') return algorithm;
    if (name === './incident-location-config') return settings;
    throw new Error(`Unexpected import: ${name}`);
  },
);

const incident = { id: 'fire-1', lat: 14.65, lng: 121.06 };
const fix = { latitude: 14.65, longitude: 121.06, accuracy: 8 };

function setup() {
  let clock = 1000;
  let successCallback;
  let errorCallback;
  let nextWatchId = 1;

  const watches = [];
  const cleared = [];
  const writes = [];
  const deletions = [];

  const geolocation = {
    watchPosition(success, error, options) {
      successCallback = success;
      errorCallback = error;
      watches.push(options);
      return nextWatchId++;
    },
    clearWatch(id) {
      cleared.push(id);
    },
  };

  const controller = createIncidentLocationController({
    geolocation,
    now: () => clock,
    writeLocation: async (incidentId, position) => {
      writes.push({ incidentId, position });
    },
    deleteLocation: async () => {
      deletions.push(clock);
    },
  });

  return {
    controller,
    watches,
    cleared,
    writes,
    deletions,
    setTime(value) { clock = value; },
    emit(coords = fix) {
      assert.ok(successCallback, 'GPS watcher must be running');
      successCallback({ coords, timestamp: clock });
    },
    fail() {
      errorCallback?.({ code: 1 });
    },
  };
}

test('GPS remains off without an active incident', async () => {
  const ctx = setup();

  ctx.controller.start([]);

  assert.equal(ctx.controller.active, false);
  assert.equal(ctx.watches.length, 0);
  assert.equal(ctx.writes.length, 0);
});

test('active incident starts a high-accuracy watcher and stops cleanly', async () => {
  const ctx = setup();

  ctx.controller.start([incident]);

  assert.equal(ctx.controller.active, true);
  assert.equal(ctx.watches.length, 1);
  assert.equal(ctx.watches[0].enableHighAccuracy, true);
  assert.equal(ctx.watches[0].maximumAge, 0);

  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);
  assert.equal(ctx.writes[0].incidentId, 'fire-1');

  ctx.controller.stop();
  await ctx.controller.settled();

  assert.equal(ctx.controller.active, false);
  assert.equal(ctx.cleared.length, 1);
  assert.equal(ctx.deletions.length, 1);

  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);
});

test('movement interval and heartbeat throttle GPS writes', async () => {
  const ctx = setup();

  ctx.controller.start([incident]);

  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);

  const moved = {
    ...fix,
    latitude: fix.latitude + 0.0001,
  };

  ctx.setTime(4999);
  ctx.emit(moved);
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);

  ctx.setTime(6000);
  ctx.emit(moved);
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 2);

  ctx.setTime(36000);
  ctx.emit(moved);
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 3);
});

test('incident termination stops GPS and deletes location without a new fix', async () => {
  const ctx = setup();

  ctx.controller.start([incident]);
  ctx.emit();
  await ctx.controller.settled();

  ctx.controller.updateIncidents([]);
  await ctx.controller.settled();

  assert.equal(ctx.controller.active, false);
  assert.equal(ctx.cleared.length, 1);
  assert.equal(ctx.deletions.length, 1);
});

test('stopping and immediately restarting cannot skip pending location cleanup', async () => {
  let gpsCallback;
  let finishWrite;
  let writeStarted;

  const started = new Promise(resolve => {
    writeStarted = resolve;
  });

  const pendingWrite = new Promise(resolve => {
    finishWrite = resolve;
  });

  const deletions = [];
  const cleared = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => 1000,
    writeLocation: async () => {
      writeStarted();
      await pendingWrite;
    },
    deleteLocation: async () => {
      deletions.push('deleted');
    },
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });

  // Ensure the first write is in flight.
  await started;

  // Incident ends, then a new incident immediately activates.
  controller.stop();
  controller.start([
    { id: 'fire-2', lat: 14.65, lng: 121.06 },
  ]);

  // The old location upload completes after the restart.
  finishWrite();

  await controller.settled();

  assert.equal(
    deletions.length,
    1,
    'Stopping must delete the old location even after an immediate restart',
  );

  assert.equal(controller.active, true);
  assert.equal(cleared.length, 1);
});

test('new GPS fix waits for old incident cleanup', async () => {
  let gpsCallback;
  let releaseFirstWrite;
  let signalFirstWrite;

  const firstWriteStarted = new Promise(resolve => {
    signalFirstWrite = resolve;
  });

  const firstWriteGate = new Promise(resolve => {
    releaseFirstWrite = resolve;
  });

  const operations = [];
  let writeCount = 0;

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 1000,
    writeLocation: async incidentId => {
      writeCount++;
      operations.push(`write-start:${incidentId}`);

      if (writeCount === 1) {
        signalFirstWrite();
        await firstWriteGate;
      }

      operations.push(`write-end:${incidentId}`);
    },
    deleteLocation: async () => {
      operations.push('delete');
    },
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });

  await firstWriteStarted;

  controller.stop();

  controller.start([
    { id: 'fire-2', lat: 14.65, lng: 121.06 },
  ]);

  gpsCallback({ coords: fix, timestamp: 1000 });

  releaseFirstWrite();
  await controller.settled();

  assert.deepEqual(
    [...operations],
    [
      'write-start:fire-1',
      'write-end:fire-1',
      'delete',
      'write-start:fire-2',
      'write-end:fire-2',
    ],
    'Old incident must be cleaned up before publishing the new incident',
  );

  assert.equal(controller.active, true);
});

test('failed GPS upload is retried on the next accurate fix', async () => {
  let gpsCallback;
  let attempts = 0;
  let successfulWrites = 0;

  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 1000,
    writeLocation: async () => {
      attempts++;

      if (attempts === 1) {
        throw new Error('Simulated network failure');
      }

      successfulWrites++;
    },
    deleteLocation: async () => {},
    onError: reason => {
      errors.push(reason);
    },
  });

  controller.start([incident]);

  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  assert.equal(attempts, 1);
  assert.equal(successfulWrites, 0);
  assert.deepEqual([...errors], ['location-write-failed']);

  // Same coordinates and timestamp: retry must still be attempted
  // because the first write never succeeded.
  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  assert.equal(attempts, 2);
  assert.equal(successfulWrites, 1);

  // After success, the usual throttling rules must apply.
  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  assert.equal(attempts, 2);
});

test('failed location deletion can be retried without restarting GPS', async () => {
  let gpsCallback;
  let deleteAttempts = 0;
  let successfulDeletions = 0;
  let watchStarts = 0;

  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        watchStarts++;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 1000,
    writeLocation: async () => {},
    deleteLocation: async () => {
      deleteAttempts++;

      if (deleteAttempts === 1) {
        throw new Error('Simulated network failure during deletion');
      }

      successfulDeletions++;
    },
    onError: reason => {
      errors.push(reason);
    },
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });

  await controller.settled();

  controller.stop();
  await controller.settled();

  assert.equal(controller.active, false);
  assert.equal(deleteAttempts, 1);
  assert.equal(successfulDeletions, 0);
  assert.deepEqual([...errors], ['location-write-failed']);

  // A second cleanup request should retry deletion without
  // activating geolocation again.
  controller.stop();
  await controller.settled();

  assert.equal(deleteAttempts, 2);
  assert.equal(successfulDeletions, 1);
  assert.equal(controller.active, false);
  assert.equal(watchStarts, 1);
});

test('failed cleanup blocks new incident publishing until deletion succeeds', async () => {
  let gpsCallback;
  let deleteAttempts = 0;
  const operations = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 1000,
    writeLocation: async incidentId => {
      operations.push(`write:${incidentId}`);
    },
    deleteLocation: async () => {
      deleteAttempts++;
      operations.push(`delete-attempt:${deleteAttempts}`);

      if (deleteAttempts === 1) {
        throw new Error('Temporary deletion failure');
      }
    },
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  controller.stop();
  await controller.settled();

  assert.equal(deleteAttempts, 1);
  assert.equal(controller.active, false);

  controller.start([
    { id: 'fire-2', lat: 14.65, lng: 121.06 },
  ]);

  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  const cleanupSucceeded = operations.indexOf('delete-attempt:2');
  const newWrite = operations.indexOf('write:fire-2');

  assert.ok(
    cleanupSucceeded !== -1,
    'Pending deletion must be retried on restart',
  );

  assert.ok(
    newWrite > cleanupSucceeded,
    'New incident must not publish before cleanup succeeds',
  );

  assert.equal(
    errors.includes('location-write-failed'),
    true,
  );
});

test('repeated cleanup failures block new GPS publishing', async () => {
  let gpsCallback;
  let deleteAttempts = 0;

  const operations = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 1000,
    writeLocation: async incidentId => {
      operations.push(`write:${incidentId}`);
    },
    deleteLocation: async () => {
      deleteAttempts++;
      operations.push(`delete:${deleteAttempts}`);

      if (deleteAttempts <= 2) {
        throw new Error('Simulated persistent network failure');
      }
    },
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  controller.stop();
  await controller.settled();

  assert.equal(deleteAttempts, 1);

  controller.start([
    { id: 'fire-2', lat: 14.65, lng: 121.06 },
  ]);

  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  assert.equal(deleteAttempts, 2);

  assert.equal(
    operations.includes('write:fire-2'),
    false,
    'New incident location must not publish after failed cleanup',
  );

  assert.equal(
    errors.filter(reason => reason === 'location-write-failed').length,
    2,
  );

  // A subsequent explicit cleanup request can retry without GPS.
  controller.stop();
  await controller.settled();

  assert.equal(deleteAttempts, 3);
  assert.equal(controller.active, false);
});

test('inaccurate GPS fix never publishes a location', async () => {
  const ctx = setup();

  ctx.controller.start([incident]);

  ctx.emit({ ...fix, accuracy: 50.01 });
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 0);

  ctx.emit({ ...fix, accuracy: 50 });
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);
});

test('leaving the 500-meter incident boundary deletes the location', async () => {
  const ctx = setup();

  ctx.controller.start([incident]);

  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);

  // Approximately 1.1 km north of the incident.
  ctx.setTime(7000);
  ctx.emit({ ...fix, latitude: 14.66 });
  await ctx.controller.settled();

  assert.equal(ctx.deletions.length, 1);
  assert.equal(ctx.writes.length, 1);

  // Tracking remains active while the trusted incident is active,
  // allowing the device to resume publishing if it returns nearby.
  assert.equal(ctx.controller.active, true);

  ctx.setTime(13000);
  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 2);
});

test('revoked GPS permission stops tracking and deletes published location', async () => {
  let gpsCallback;
  let gpsErrorCallback;

  const cleared = [];
  const writes = [];
  const deletions = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success, error) {
        gpsCallback = success;
        gpsErrorCallback = error;
        return 7;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => 1000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {
      deletions.push('deleted');
    },
    onError: reason => {
      errors.push(reason);
    },
  });

  controller.start([incident]);

  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  assert.equal(writes.length, 1);
  assert.equal(controller.active, true);

  // Browser reports PERMISSION_DENIED after previously
  // allowing the device to publish its position.
  gpsErrorCallback({
    code: 1,
    message: 'User denied Geolocation',
  });

  await controller.settled();

  assert.equal(
    controller.active,
    false,
    'GPS tracking must stop when permission is revoked',
  );

  assert.deepEqual(
    [...cleared],
    [7],
    'The existing GPS watcher must be cleared',
  );

  assert.equal(
    deletions.length,
    1,
    'Previously published location must be deleted',
  );

  assert.ok(
    errors.includes('geolocation-permission-denied'),
    'UI must receive a specific permission error',
  );
});

test('temporary GPS timeout does not terminate incident tracking', async () => {
  let gpsCallback;
  let gpsErrorCallback;

  const errors = [];
  const cleared = [];
  const writes = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success, error) {
        gpsCallback = success;
        gpsErrorCallback = error;
        return 3;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => 1000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {},
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);

  gpsErrorCallback({
    code: 3,
    message: 'Position timeout',
  });

  assert.equal(controller.active, true);
  assert.equal(cleared.length, 0);
  assert.deepEqual([...errors], ['geolocation-unavailable']);

  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  assert.deepEqual([...writes], ['fire-1']);
});

test('obsolete GPS permission callback cannot stop a newer session', async () => {
  const errorCallbacks = [];
  const cleared = [];
  const errors = [];
  const writes = [];
  const deletions = [];

  let currentGpsCallback;
  let nextWatchId = 1;

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success, error) {
        currentGpsCallback = success;
        errorCallbacks.push(error);
        return nextWatchId++;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => 1000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {
      deletions.push('deleted');
    },
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);
  currentGpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  controller.stop();
  await controller.settled();

  controller.start([
    { id: 'fire-2', lat: 14.65, lng: 121.06 },
  ]);

  assert.equal(controller.active, true);
  assert.equal(errorCallbacks.length, 2);

  const deletionsBefore = deletions.length;

  // Delayed callback belonging to the already stopped watcher.
  errorCallbacks[0]({
    code: 1,
    message: 'Obsolete permission-denied event',
  });

  await controller.settled();

  assert.equal(controller.active, true);
  assert.equal(deletions.length, deletionsBefore);
  assert.equal(errors.includes('geolocation-permission-denied'), false);

  currentGpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  assert.deepEqual([...writes], ['fire-1', 'fire-2']);
  assert.deepEqual([...cleared], [1]);
});

test('poor GPS accuracy reports a warning without stopping tracking', async () => {
  let gpsCallback;

  const errors = [];
  const writes = [];
  const cleared = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => 1000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {},
    onError: reason => {
      errors.push(reason);
    },
  });

  controller.start([incident]);

  gpsCallback({
    coords: { ...fix, accuracy: 75 },
    timestamp: 1000,
  });

  await controller.settled();

  assert.deepEqual(
    [...errors],
    ['gps-accuracy-too-low'],
  );

  assert.equal(writes.length, 0);
  assert.equal(controller.active, true);
  assert.equal(cleared.length, 0);

  // GPS accuracy improves to the permitted threshold.
  gpsCallback({
    coords: { ...fix, accuracy: 50 },
    timestamp: 1000,
  });

  await controller.settled();

  assert.deepEqual([...writes], ['fire-1']);
  assert.equal(controller.active, true);
  assert.equal(cleared.length, 0);
});

test('trusted incident changes reuse the existing GPS watcher', async () => {
  const ctx = setup();

  ctx.controller.start([incident]);

  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);
  assert.equal(ctx.writes[0].incidentId, 'fire-1');
  assert.equal(ctx.watches.length, 1);

  // The trusted incident feed replaces the assigned incident.
  ctx.setTime(7000);

  ctx.controller.updateIncidents([
    { id: 'fire-2', lat: 14.65, lng: 121.06 },
  ]);

  await ctx.controller.settled();

  assert.equal(ctx.controller.active, true);

  assert.equal(
    ctx.watches.length,
    1,
    'Changing incidents must not create another GPS watcher',
  );

  assert.equal(ctx.cleared.length, 0);

  assert.equal(
    ctx.writes.length,
    2,
    'The controller should process the latest GPS fix on incident change',
  );

  assert.equal(ctx.writes[1].incidentId, 'fire-2');

  // Further GPS callbacks continue using the existing watcher.
  ctx.setTime(37000);
  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 3);
  assert.equal(ctx.writes[2].incidentId, 'fire-2');
  assert.equal(ctx.watches.length, 1);
});

test('stale cached GPS fix cannot authorize a new incident', async () => {
  const ctx = setup();

  ctx.controller.start([incident]);

  // First position is received at t = 1 second.
  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 1);
  assert.equal(ctx.writes[0].incidentId, 'fire-1');

  // Five minutes pass without another GPS callback.
  ctx.setTime(301000);

  ctx.controller.updateIncidents([
    { id: 'fire-2', lat: 14.65, lng: 121.06 },
  ]);

  await ctx.controller.settled();

  assert.equal(
    ctx.writes.length,
    1,
    'A five-minute-old GPS fix must not publish for a new incident',
  );

  assert.equal(ctx.controller.active, true);
  assert.equal(ctx.watches.length, 1);

  // A genuinely new, accurate GPS callback arrives.
  ctx.emit();
  await ctx.controller.settled();

  assert.equal(ctx.writes.length, 2);
  assert.equal(ctx.writes[1].incidentId, 'fire-2');
});

test('browser GPS position older than 30 seconds is rejected', async () => {
  let gpsCallback;
  const writes = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 301000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {},
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);

  gpsCallback({
    coords: fix,
    timestamp: 1000,
  });

  await controller.settled();

  assert.equal(writes.length, 0);
  assert.deepEqual([...errors], ['gps-position-stale']);
  assert.equal(controller.active, true);
});

test('future-dated browser GPS position is rejected', async () => {
  let gpsCallback;
  const writes = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 100000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {},
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);

  gpsCallback({
    coords: fix,
    timestamp: 101000,
  });

  await controller.settled();

  assert.equal(writes.length, 0);
  assert.deepEqual([...errors], ['gps-position-stale']);
  assert.equal(controller.active, true);
});

test('fresh browser GPS timestamp allows publishing', async () => {
  let gpsCallback;
  const writes = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 100000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {},
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);

  gpsCallback({
    coords: fix,
    timestamp: 99000,
  });

  await controller.settled();

  assert.deepEqual([...writes], ['fire-1']);
  assert.deepEqual([...errors], []);
  assert.equal(controller.active, true);
});

test('GPS callback without a timestamp cannot publish location', async () => {
  let gpsCallback;
  const writes = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 100000,
    writeLocation: async incidentId => {
      writes.push(incidentId);
    },
    deleteLocation: async () => {},
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);

  // Simulate a malformed callback without the required
  // GeolocationPosition.timestamp property.
  gpsCallback({
    coords: fix,
  });

  await controller.settled();

  assert.equal(
    writes.length,
    0,
    'Missing GPS acquisition timestamp must prevent publishing',
  );

  assert.deepEqual([...errors], ['gps-position-stale']);
  assert.equal(controller.active, true);
});

test('queued GPS fix cannot publish after becoming stale', async () => {
  let clock = 1000;
  let gpsCallback;
  let releaseFirstWrite;
  let signalFirstWrite;

  const firstWriteStarted = new Promise(resolve => {
    signalFirstWrite = resolve;
  });

  const firstWriteGate = new Promise(resolve => {
    releaseFirstWrite = resolve;
  });

  const writes = [];
  const errors = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => clock,
    writeLocation: async (incidentId, position) => {
      writes.push({ incidentId, lat: position.lat });

      if (writes.length === 1) {
        signalFirstWrite();
        await firstWriteGate;
      }
    },
    deleteLocation: async () => {},
    onError: reason => errors.push(reason),
  });

  controller.start([incident]);

  // First accurate position starts an upload.
  gpsCallback({ coords: fix, timestamp: clock });
  await firstWriteStarted;

  // Another accurate position arrives while upload #1 is pending.
  clock = 7000;

  gpsCallback({
    coords: {
      ...fix,
      latitude: fix.latitude + 0.0001,
    },
    timestamp: clock,
  });

  // The second position becomes more than 30 seconds old.
  clock = 40000;

  releaseFirstWrite();
  await controller.settled();

  assert.equal(
    writes.length,
    1,
    'A queued GPS fix must not publish after becoming stale',
  );

  assert.equal(controller.active, true);
});

test('movement throttle starts after successful upload completion', async () => {
  let clock = 1000;
  let gpsCallback;
  let finishFirstWrite;
  let firstWriteStarted;

  const started = new Promise(resolve => {
    firstWriteStarted = resolve;
  });

  const firstWriteGate = new Promise(resolve => {
    finishFirstWrite = resolve;
  });

  const writes = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => clock,
    writeLocation: async incidentId => {
      writes.push(incidentId);

      if (writes.length === 1) {
        firstWriteStarted();
        await firstWriteGate;
      }
    },
    deleteLocation: async () => {},
  });

  controller.start([incident]);

  gpsCallback({ coords: fix, timestamp: clock });
  await started;

  // First upload finishes six seconds after it started.
  clock = 7000;
  finishFirstWrite();
  await controller.settled();

  assert.equal(writes.length, 1);

  const moved = {
    ...fix,
    latitude: fix.latitude + 0.0001,
  };

  // Only one millisecond has elapsed since successful completion.
  clock = 7001;
  gpsCallback({ coords: moved, timestamp: clock });
  await controller.settled();

  assert.equal(
    writes.length,
    1,
    'Movement must wait five seconds after the previous upload succeeds',
  );

  // Five seconds after successful completion, movement may upload.
  clock = 12000;
  gpsCallback({ coords: moved, timestamp: clock });
  await controller.settled();

  assert.equal(writes.length, 2);
});

test('heartbeat interval starts after successful upload completion', async () => {
  let clock = 1000;
  let gpsCallback;
  let releaseFirstWrite;
  let signalFirstWrite;

  const firstWriteStarted = new Promise(resolve => {
    signalFirstWrite = resolve;
  });

  const firstWriteGate = new Promise(resolve => {
    releaseFirstWrite = resolve;
  });

  const writes = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch() {},
    },
    now: () => clock,
    writeLocation: async incidentId => {
      writes.push(incidentId);

      if (writes.length === 1) {
        signalFirstWrite();
        await firstWriteGate;
      }
    },
    deleteLocation: async () => {},
  });

  controller.start([incident]);

  gpsCallback({ coords: fix, timestamp: clock });
  await firstWriteStarted;

  // The first upload completes six seconds after it began.
  clock = 7000;
  releaseFirstWrite();
  await controller.settled();

  assert.equal(writes.length, 1);

  // Thirty seconds after upload START, but only 24 seconds
  // after successful completion: heartbeat must not run.
  clock = 31000;
  gpsCallback({ coords: fix, timestamp: clock });
  await controller.settled();

  assert.equal(
    writes.length,
    1,
    'Heartbeat must wait 30 seconds after successful completion',
  );

  // Exactly 30 seconds after successful completion.
  clock = 37000;
  gpsCallback({ coords: fix, timestamp: clock });
  await controller.settled();

  assert.equal(writes.length, 2);
});

test('incident termination cancels queued GPS updates before cleanup', async () => {
  let clock = 1000;
  let gpsCallback;
  let releaseFirstWrite;
  let signalFirstWrite;

  const firstWriteStarted = new Promise(resolve => {
    signalFirstWrite = resolve;
  });

  const firstWriteGate = new Promise(resolve => {
    releaseFirstWrite = resolve;
  });

  const operations = [];
  let writeCount = 0;
  const cleared = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => clock,
    writeLocation: async incidentId => {
      writeCount++;
      operations.push(`write-start:${incidentId}`);

      if (writeCount === 1) {
        signalFirstWrite();
        await firstWriteGate;
      }

      operations.push(`write-end:${incidentId}`);
    },
    deleteLocation: async () => {
      operations.push('delete');
    },
  });

  controller.start([incident]);

  gpsCallback({ coords: fix, timestamp: clock });
  await firstWriteStarted;

  // Another fresh fix arrives while the first upload is pending.
  clock = 7000;

  gpsCallback({
    coords: {
      ...fix,
      latitude: fix.latitude + 0.0001,
    },
    timestamp: clock,
  });

  // The trusted incident ends before that second fix is processed.
  controller.updateIncidents([]);

  assert.equal(controller.active, false);
  assert.deepEqual([...cleared], [1]);

  // Let the in-flight upload finish.
  releaseFirstWrite();
  await controller.settled();

  assert.deepEqual(
    [...operations],
    [
      'write-start:fire-1',
      'write-end:fire-1',
      'delete',
    ],
    'Queued location updates must be cancelled before final cleanup',
  );

  assert.equal(writeCount, 1);
  assert.equal(controller.active, false);
});

test('stopAndSettle waits for an in-flight write before deleting', async () => {
  let gpsCallback;
  let signalWriteStarted;
  let releaseWrite;

  const writeStarted = new Promise(resolve => {
    signalWriteStarted = resolve;
  });

  const writeGate = new Promise(resolve => {
    releaseWrite = resolve;
  });

  const operations = [];
  const cleared = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => 1000,
    writeLocation: async () => {
      operations.push('write-start');
      signalWriteStarted();
      await writeGate;
      operations.push('write-end');
    },
    deleteLocation: async () => {
      operations.push('delete');
    },
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });

  await writeStarted;

  let shutdownFinished = false;
  const shutdown = controller.stopAndSettle().then(() => {
    shutdownFinished = true;
  });

  try {
    assert.equal(controller.active, false);
    assert.deepEqual(cleared, [1]);

    await Promise.resolve();

    assert.equal(shutdownFinished, false);
    assert.deepEqual(operations, ['write-start']);
  } finally {
    releaseWrite();
  }

  await shutdown;

  assert.equal(shutdownFinished, true);
  assert.deepEqual(
    operations,
    ['write-start', 'write-end', 'delete'],
  );
});

test('stopAndSettle rejects when location deletion fails', async () => {
  let gpsCallback;
  let deletionAttempts = 0;
  const cleared = [];

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        return 1;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    now: () => 1000,
    writeLocation: async () => {},
    deleteLocation: async () => {
      deletionAttempts++;
      throw new Error('Simulated deletion failure');
    },
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  await assert.rejects(
    controller.stopAndSettle(),
    /incident-location-cleanup-failed/,
  );

  assert.equal(controller.active, false);
  assert.deepEqual(cleared, [1]);
  assert.equal(deletionAttempts, 1);
});

test('stopAndSettle retries cleanup without restarting GPS', async () => {
  let gpsCallback;
  let watchStarts = 0;
  let deletionAttempts = 0;

  const controller = createIncidentLocationController({
    geolocation: {
      watchPosition(success) {
        gpsCallback = success;
        watchStarts++;
        return 1;
      },
      clearWatch() {},
    },
    now: () => 1000,
    writeLocation: async () => {},
    deleteLocation: async () => {
      deletionAttempts++;

      if (deletionAttempts === 1) {
        throw new Error('Temporary deletion failure');
      }
    },
  });

  controller.start([incident]);
  gpsCallback({ coords: fix, timestamp: 1000 });
  await controller.settled();

  await assert.rejects(
    controller.stopAndSettle(),
    /incident-location-cleanup-failed/,
  );

  await controller.stopAndSettle();

  assert.equal(controller.active, false);
  assert.equal(watchStarts, 1);
  assert.equal(deletionAttempts, 2);
});
