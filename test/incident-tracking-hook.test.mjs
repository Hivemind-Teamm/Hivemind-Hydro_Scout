import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const suffix = randomUUID();
const mockPath = join(root, 'lib', `.incident-hook-mocks-${suffix}.mjs`);
const hookPath = join(root, 'lib', `.incident-hook-test-${suffix}.mjs`);

const mockSource = `
export const harness = {
  auth: { user: null, role: null, trustedStationId: null },
  feed: { verified: false, incidents: [], error: null },
  writers: 0,
  writes: 0,
  watchers: 0,
  stops: 0,
  deletions: 0,
  deletionGate: null,
  writeGate: null,
  lastControllerDependencies: null,
  registration: null,
  reset() {
    this.auth = { user: null, role: null, trustedStationId: null };
    this.feed = { verified: false, incidents: [], error: null };
    this.writers = 0;
    this.writes = 0;
    this.watchers = 0;
    this.stops = 0;
    this.deletions = 0;
    this.deletionGate = null;
    this.writeGate = null;
    this.lastControllerDependencies = null;
    this.registration = null;
  },
};

export const auth = { currentUser: null };
export const db = {};

export function isIncidentVerificationFresh(verifiedAt, now = Date.now()) {
  return (
    typeof verifiedAt === 'number' &&
    Number.isFinite(verifiedAt) &&
    Number.isFinite(now) &&
    now >= verifiedAt &&
    now - verifiedAt < 15_000
  );
}

export function useAuth() {
  return harness.auth;
}

export function useAssignedIncidents() {
  return harness.feed;
}

export function useIncidentWakeLock() {
  return { held: false, supported: false };
}

export function createIncidentLocationWriter() {
  harness.writers++;
  return {
    writeLocation: async () => {
      harness.writes++;
      if (harness.writeGate) {
        await harness.writeGate;
      }
    },
    deleteLocation: async () => {
      harness.deletions++;
      if (harness.deletionGate) {
        await harness.deletionGate;
      }
    },
  };
}

export function createIncidentLocationController(dependencies) {
  harness.lastControllerDependencies = dependencies;
  let active = false;

  return {
    start(incidents) {
      if (!incidents.length) return;
      active = true;
      harness.watchers++;
    },
    updateIncidents(incidents) {
      if (!incidents.length) this.stop();
    },
    stop() {
      if (!active) return;
      active = false;
      harness.stops++;
    },
    async stopAndSettle() {
      this.stop();
      await dependencies.deleteLocation();
    },
    get active() {
      return active;
    },
  };
}

export const incidentLocationCleanupRegistry = {
  get registeredUid() {
    return harness.registration?.uid ?? null;
  },
  register(uid, cleanup) {
    if (harness.registration) {
      throw new Error('cleanup-already-registered');
    }
    const entry = { uid, cleanup };
    harness.registration = entry;
    return () => {
      if (harness.registration === entry) {
        harness.registration = null;
      }
    };
  },
  async cleanup(uid) {
    if (harness.registration?.uid !== uid) {
      throw new Error('incident-cleanup-unavailable');
    }
    await harness.registration.cleanup();
  },
};
`;

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:3002',
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});

Object.defineProperty(dom.window.navigator, 'geolocation', {
  configurable: true,
  value: {
    watchPosition: () => 1,
    clearWatch: () => {},
  },
});

let testing;
let React;
let useIncidentTracking;
let harness;
let registry;
let auth;

try {
  await writeFile(mockPath, mockSource);

  const original = await readFile(
    join(root, 'lib', 'use-incident-tracking.ts'),
    'utf8',
  );

  const compiled = ts.transpileModule(original, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: 'use-incident-tracking.ts',
    reportDiagnostics: true,
  });

  const mockFilename = './' + mockPath.split(/[\\/]/).at(-1);

  // Replace only the hook's relative dependency imports.
  // Its actual React hooks and effect implementation remain intact.
  const isolated = compiled.outputText.replace(
    /from ['"]\.\/[^'"]+['"]/g,
    `from '${mockFilename}'`,
  );

  await writeFile(hookPath, isolated);

  React = await import('react');
  testing = await import('@testing-library/react');

  const mockModule = await import(pathToFileURL(mockPath).href);
  const hookModule = await import(pathToFileURL(hookPath).href);

  harness = mockModule.harness;
  registry = mockModule.incidentLocationCleanupRegistry;
  auth = mockModule.auth;
  useIncidentTracking = hookModule.useIncidentTracking;
} catch (error) {
  await Promise.allSettled([
    unlink(mockPath),
    unlink(hookPath),
  ]);
  dom.window.close();
  throw error;
}

after(async () => {
  testing.cleanup();
  await Promise.allSettled([
    unlink(mockPath),
    unlink(hookPath),
  ]);
  dom.window.close();
});

function mountHook(enabled = true) {
  let latest = null;

  function Probe() {
    latest = useIncidentTracking(enabled);
    return null;
  }

  const view = testing.render(React.createElement(Probe));

  return {
    rerender: () => view.rerender(React.createElement(Probe)),
    unmount: () => view.unmount(),
    get state() {
      return latest;
    },
  };
}

function setEligibleUser() {
  harness.auth = {
    user: { uid: 'test-sub-admin' },
    role: 'sub_admin',
    trustedStationId: 'station-001',
  };
  auth.currentUser = { uid: 'test-sub-admin' };
}

function verifyIncident() {
  harness.feed = {
    verified: true,
    verifiedAt: Date.now(),
    incidents: [
      { id: 'incident-001', lat: 14.65, lng: 121.05 },
    ],
    error: null,
  };
}

test('no GPS or writer for anonymous and unverified sessions', () => {
  harness.reset();

  const view = mountHook();
  assert.equal(harness.writers, 0);
  assert.equal(harness.watchers, 0);

  setEligibleUser();
  view.rerender();

  assert.equal(harness.writers, 0);
  assert.equal(harness.watchers, 0);

  view.unmount();
});

test('verified assignment creates exactly one tracking session', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  assert.equal(harness.writers, 1);
  assert.equal(harness.watchers, 1);
  assert.equal(view.state.watching, true);
  assert.equal(view.state.sharing, false);
  assert.equal(registry.registeredUid, 'test-sub-admin');

  view.rerender();

  assert.equal(harness.writers, 1);
  assert.equal(harness.watchers, 1);

  view.unmount();

  await testing.waitFor(() => {
    assert.equal(registry.registeredUid, null);
  });
});

test('revoked feed stops GPS and removes the tracking session', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();
  assert.equal(harness.watchers, 1);

  harness.feed = {
    verified: false,
    incidents: [],
    error: 'incident-feed-unavailable',
  };

  view.rerender();

  await testing.waitFor(() => {
    assert.equal(harness.stops, 1);
    assert.equal(harness.deletions, 1);
    assert.equal(registry.registeredUid, null);
  });

  assert.equal(harness.watchers, 1);
  view.unmount();
});

test('logout cleanup prevents tracking from restarting', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  await testing.act(async () => {
    await registry.cleanup('test-sub-admin');
  });

  assert.equal(harness.stops, 1);
  assert.equal(harness.deletions, 1);
  assert.equal(registry.registeredUid, null);

  view.rerender();

  assert.equal(harness.watchers, 1);
  assert.equal(harness.writers, 1);

  view.unmount();
});
test('account switch waits for previous account deletion', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  assert.equal(harness.watchers, 1);
  assert.equal(harness.writers, 1);

  let releaseDeletion;

  harness.deletionGate = new Promise(resolve => {
    releaseDeletion = resolve;
  });

  harness.auth = {
    user: { uid: 'different-sub-admin' },
    role: 'sub_admin',
    trustedStationId: 'station-002',
  };

  try {
    view.rerender();

    assert.equal(harness.stops, 1);
    assert.equal(harness.watchers, 1);
    assert.equal(harness.writers, 1);

    await testing.waitFor(() => {
      assert.equal(harness.deletions, 1);
    });

    // The second account must not start while deletion is unfinished.
    assert.equal(harness.watchers, 1);
    assert.equal(harness.writers, 1);
    assert.equal(registry.registeredUid, 'test-sub-admin');
  } finally {
    releaseDeletion();
  }

  await testing.waitFor(() => {
    assert.equal(registry.registeredUid, 'different-sub-admin');
    assert.equal(harness.watchers, 2);
    assert.equal(harness.writers, 2);
  });

  view.unmount();

  await testing.waitFor(() => {
    assert.equal(registry.registeredUid, null);
  });
});

test('failed account-switch cleanup prevents replacement tracking', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  harness.deletionGate = Promise.reject(
    new Error('simulated-firestore-delete-failure'),
  );

  // Attach a rejection handler immediately to avoid an unhandled
  // rejection before the React effect reaches the cleanup operation.
  harness.deletionGate.catch(() => {});

  harness.auth = {
    user: { uid: 'different-sub-admin' },
    role: 'sub_admin',
    trustedStationId: 'station-002',
  };

  view.rerender();

  await testing.waitFor(() => {
    assert.equal(view.state.error, 'incident-location-cleanup-failed');
  });

  assert.equal(harness.stops, 1);
  assert.equal(harness.watchers, 1);
  assert.equal(harness.writers, 1);
  assert.equal(registry.registeredUid, 'test-sub-admin');

  // No second session may start merely because React renders again.
  view.rerender();

  assert.equal(harness.watchers, 1);
  assert.equal(harness.writers, 1);

  view.unmount();
});
test('late upload completion cannot restore sharing after revocation', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  assert.equal(harness.watchers, 1);

  let releaseUpload;
  harness.writeGate = new Promise(resolve => {
    releaseUpload = resolve;
  });

  const pendingWrite =
    harness.lastControllerDependencies.writeLocation(
      'incident-001',
      { lat: 14.65, lng: 121.05, accuracy: 10 },
    );

  try {
    harness.feed = {
      verified: false,
      incidents: [],
      error: 'incident-feed-unavailable',
    };

    view.rerender();

    await testing.waitFor(() => {
      assert.equal(harness.stops, 1);
      assert.equal(registry.registeredUid, null);
    });

    assert.equal(view.state.sharing, false);

    await testing.act(async () => {
      releaseUpload();
      await pendingWrite;
    });

    assert.equal(
      view.state.sharing,
      false,
      'An obsolete successful upload must not reactivate sharing status',
    );
  } finally {
    releaseUpload();
    await pendingWrite;
    view.unmount();
  }
});
test('unmount retains cleanup registration until deletion succeeds', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  assert.equal(harness.watchers, 1);
  assert.equal(registry.registeredUid, 'test-sub-admin');

  let releaseDeletion;

  harness.deletionGate = new Promise(resolve => {
    releaseDeletion = resolve;
  });

  try {
    view.unmount();

    // The GPS watcher must stop synchronously.
    assert.equal(harness.stops, 1);
    assert.equal(harness.watchers, 1);

    await testing.waitFor(() => {
      assert.equal(harness.deletions, 1);
    });

    // Do not lose cleanup responsibility while deletion is pending.
    assert.equal(registry.registeredUid, 'test-sub-admin');
  } finally {
    releaseDeletion();
  }

  await testing.waitFor(() => {
    assert.equal(registry.registeredUid, null);
  });
});

test('failed unmount deletion preserves logout cleanup responsibility', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  const failure = Promise.reject(
    new Error('simulated-unmount-delete-failure'),
  );

  // Prevent an unrelated unhandled-rejection warning.
  failure.catch(() => {});

  harness.deletionGate = failure;

  view.unmount();

  await testing.waitFor(() => {
    assert.equal(harness.stops, 1);
    assert.equal(harness.deletions, 1);
  });

  // Even after the component has gone away, the registration
  // must not be discarded as though deletion succeeded.
  assert.equal(registry.registeredUid, 'test-sub-admin');
  assert.equal(harness.watchers, 1);
});
test('disabled tracking gate prevents writer creation and GPS activation', () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook(false);

  assert.equal(harness.writers, 0);
  assert.equal(harness.watchers, 0);
  assert.equal(registry.registeredUid, null);
  assert.equal(view.state.eligible, false);
  assert.equal(view.state.sharing, false);

  view.rerender();

  assert.equal(harness.writers, 0);
  assert.equal(harness.watchers, 0);

  view.unmount();
});

test('expired assignment prevents a GPS write', async () => {
  harness.reset();
  setEligibleUser();
  verifyIncident();

  const view = mountHook();

  try {
    assert.equal(harness.watchers, 1);
    assert.equal(harness.writes, 0);

    // The assignment was valid when tracking started.
    // Simulate a suspended browser timer by aging verification
    // without triggering the normal polling-expiry callback.
    harness.feed = {
      ...harness.feed,
      verifiedAt: Date.now() - 30_000,
    };

    view.rerender();

    await testing.act(async () => {
      await assert.rejects(
        harness.lastControllerDependencies.writeLocation(
          'incident-001',
          { lat: 14.65, lng: 121.05, accuracy: 10 },
        ),
        /incident-verification-expired/,
      );
    });

    assert.equal(
      harness.writes,
      0,
      'Expired authorization must not reach the Firestore writer',
    );

    assert.equal(harness.stops, 1);
    assert.equal(view.state.sharing, false);
    assert.equal(view.state.watching, false);
  } finally {
    view.unmount();
  }

  await testing.waitFor(() => {
    assert.equal(registry.registeredUid, null);
  });
});