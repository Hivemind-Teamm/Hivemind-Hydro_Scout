import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));
const VERSION = '2026-10-23-v5';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class MockTimestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  isEqual(other) {
    return other instanceof MockTimestamp &&
      this.seconds === other.seconds &&
      this.nanoseconds === other.nanoseconds;
  }
  static fromMillis(ms) {
    return new MockTimestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
}

function harness() {
  const documentListeners = new Map();
  const browserListeners = new Map();
  const storage = new Map();
  const writes = [];
  const slots = [];
  const queuedEffects = [];
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let cursor = 0;
  let dirty = false;
  let currentUid = 'person-1';
  let output;
  let governance = {
    loading: false,
    error: null,
    configured: true,
    revision: 'published:100:5',
    publishedAt: new MockTimestamp(100, 5),
  };

  const windowMock = {
    addEventListener(name, listener) {
      if (!browserListeners.has(name)) browserListeners.set(name, new Set());
      browserListeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      browserListeners.get(name)?.delete(listener);
    },
  };
  const storageMock = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: windowMock,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, value: storageMock,
  });

  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {
          kind: 'state',
          value: typeof initial === 'function' ? initial() : initial,
        };
      }
      const set = update => {
        const old = slots[index].value;
        const next = typeof update === 'function' ? update(old) : update;
        if (!Object.is(old, next)) {
          slots[index].value = next;
          dirty = true;
        }
      };
      return [slots[index].value, set];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const prior = slots[index];
      const changed = !prior ||
        !dependencies ||
        !prior.dependencies ||
        dependencies.length !== prior.dependencies.length ||
        dependencies.some((value, i) => !Object.is(value, prior.dependencies[i]));
      if (changed) queuedEffects.push({ index, effect, dependencies });
    },
  };

  const firestore = {
    doc(_db, ...parts) { return parts.join('/'); },
    onSnapshot(path, optionsOrNext, nextOrError, maybeError) {
      const next = typeof optionsOrNext === 'function'
        ? optionsOrNext : nextOrError;
      const error = typeof optionsOrNext === 'function'
        ? nextOrError : maybeError;
      const listener = { next, error };
      if (!documentListeners.has(path)) documentListeners.set(path, new Set());
      documentListeners.get(path).add(listener);
      return () => documentListeners.get(path)?.delete(listener);
    },
    setDoc(path, data) {
      const result = deferred();
      writes.push({ path, data, ...result });
      return result.promise;
    },
    serverTimestamp() { return 'server-time'; },
    Timestamp: MockTimestamp,
  };

  const source = readFileSync('lib/use-location-consent.ts', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  const mocks = {
    react,
    'firebase/firestore': firestore,
    './firebase': { db: {} },
    './unit-location': {
      consentScopeForResponse(data) { return data?.stationId ?? null; },
    },
    './privacy-governance': {
      usePrivacyGovernance() { return governance; },
    },
    './location-consent': {
      LOCATION_NOTICE_VERSION: VERSION,
      consentKey(uid, stationId) {
        return `hydroscout-location-consent:${uid}:${stationId}`;
      },
      readLocationConsent(uid, stationId) {
        const raw = storage.get(`hydroscout-location-consent:${uid}:${stationId}`);
        if (!raw) return null;
        const record = JSON.parse(raw);
        return record.uid === uid && record.stationId === stationId &&
          record.version === VERSION ? record : null;
      },
    },
  };
  new Function('require', 'exports', compiled)(
    id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id),
    exports,
  );

  function render() {
    cursor = 0;
    queuedEffects.length = 0;
    dirty = false;
    output = exports.useLocationConsent(currentUid);
    // Clean up changed effects before installing their replacements.
    for (const item of queuedEffects) slots[item.index]?.cleanup?.();
    for (const item of queuedEffects) {
      slots[item.index] = {
        kind: 'effect',
        dependencies: item.dependencies,
        cleanup: item.effect(),
      };
    }
  }
  function flush() {
    for (let attempts = 0; attempts < 30; attempts++) {
      render();
      if (!dirty) return output;
    }
    throw new Error('Mock React hook did not settle');
  }
  function emit(path, data, metadata = {}) {
    const snapshot = {
      data() { return data; },
      metadata: {
        fromCache: false,
        hasPendingWrites: false,
        ...metadata,
      },
    };
    for (const listener of [...(documentListeners.get(path) ?? [])]) {
      listener.next(snapshot);
    }
    flush();
  }
  function emitStorage() {
    for (const listener of browserListeners.get('storage') ?? []) listener();
    flush();
  }
  function profile(stationId, uid = currentUid) {
    emit(`users/${uid}`, { stationId });
  }
  function consent(decision, {
    uid = currentUid,
    stationId = 'station-1',
    updatedAt = governance.publishedAt,
    metadata,
  } = {}) {
    emit(`users/${uid}/locationConsents/${stationId}`, {
      uid,
      stationId,
      noticeVersion: VERSION,
      governanceUpdatedAt: updatedAt,
      decision,
    }, metadata);
  }
  function dispose() {
    for (const slot of slots) slot?.cleanup?.();
    for (const [name, descriptor] of [
      ['window', originalWindow],
      ['localStorage', originalLocalStorage],
    ]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  flush();
  return {
    get state() { return output; },
    get writes() { return writes; },
    flush,
    profile,
    consent,
    emit,
    emitStorage,
    storage,
    dispose,
    setUid(value) { currentUid = value; flush(); },
    setGovernance(value) { governance = { ...governance, ...value }; flush(); },
  };
}

test('missing or cached server consent cannot authorize station GPS', t => {
  const h = harness();
  t.after(h.dispose);
  h.profile('station-1');
  assert.equal(h.state.canUseDeviceLocation, false);
  h.consent('granted', { metadata: { fromCache: true } });
  assert.equal(h.state.canUseDeviceLocation, false);
  h.consent('granted', { metadata: { hasPendingWrites: true } });
  assert.equal(h.state.canUseDeviceLocation, false);
  h.consent('granted');
  assert.equal(h.state.canUseDeviceLocation, true);
});

test('offline withdrawal overrides stale grant after governance returns', t => {
  const h = harness();
  t.after(h.dispose);
  h.profile('station-1');
  h.consent('granted');
  assert.equal(h.state.canUseDeviceLocation, true);
  h.setGovernance({ loading: true, revision: null, publishedAt: null });
  h.state.decide('declined');
  h.flush();
  assert.equal(h.state.canUseDeviceLocation, false);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.decision, 'declined');
  h.setGovernance({
    loading: false,
    revision: 'published:100:5',
    publishedAt: new MockTimestamp(100, 5),
  });
  h.consent('granted');
  assert.equal(h.state.canUseDeviceLocation, false);
});

test('a pending or rejected new grant cannot reuse an old server grant', async t => {
  const h = harness();
  t.after(h.dispose);
  h.profile('station-1');
  h.consent('granted');
  h.state.decide('granted');
  h.flush();
  assert.equal(h.state.canUseDeviceLocation, false);
  assert.equal(h.writes.length, 1);
  h.writes[0].reject(new Error('offline'));
  await tick();
  h.flush();
  assert.equal(h.state.canUseDeviceLocation, false);
  h.consent('granted');
  assert.equal(h.state.canUseDeviceLocation, false);
});

test('switching accounts cannot reuse the previous user consent', t => {
  const h = harness();
  t.after(h.dispose);
  h.profile('station-1');
  h.consent('granted');
  assert.equal(h.state.canUseDeviceLocation, true);
  h.setUid('person-2');
  assert.equal(h.state.canUseDeviceLocation, false);
  h.profile('station-1');
  assert.equal(h.state.canUseDeviceLocation, false);
  h.consent('granted');
  assert.equal(h.state.canUseDeviceLocation, true);
});

test('switching station invalidates the previous station consent', t => {
  const h = harness();
  t.after(h.dispose);
  h.profile('station-1');
  h.consent('granted');
  assert.equal(h.state.canUseDeviceLocation, true);
  h.profile('station-2');
  assert.equal(h.state.canUseDeviceLocation, false);
  h.consent('granted', { stationId: 'station-2' });
  assert.equal(h.state.canUseDeviceLocation, true);
});

test('governance timestamp does not block station GPS while the prerequisite is disabled', t => {
  const h = harness();
  t.after(h.dispose);
  h.profile('station-1');
  h.consent('granted', { updatedAt: new MockTimestamp(99, 5) });
  assert.equal(h.state.canUseDeviceLocation, true);
  h.setGovernance({
    revision: 'published:101:0',
    publishedAt: new MockTimestamp(101, 0),
  });
  assert.equal(h.state.canUseDeviceLocation, true);
});

test('a local refusal stays effective across storage synchronization', t => {
  const h = harness();
  t.after(h.dispose);
  h.profile('station-1');
  h.consent('granted');
  h.state.decide('declined');
  h.flush();
  assert.equal(h.state.canUseDeviceLocation, false);
  h.emitStorage();
  assert.equal(h.state.canUseDeviceLocation, false);
});

// STEP 48B.5D.12: CONSENT UI STATE REGRESSIONS

test('pending grant displays saving state without enabling GPS', async t => {
  const h = harness();
  t.after(h.dispose);

  h.profile('station-1');

  assert.equal(h.state.canUseDeviceLocation, false);

  h.state.decide('granted');
  h.flush();

  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.decision, 'granted');
  assert.equal(h.state.savingConsent, true);
  assert.equal(h.state.noticeOpen, true);
  assert.equal(h.state.canUseDeviceLocation, false);

  h.writes[0].resolve();
  await tick();
  h.flush();

  assert.equal(h.state.savingConsent, false);
  assert.equal(
    h.state.canUseDeviceLocation,
    false,
    'Write acknowledgement alone must not authorize GPS',
  );

  h.consent('granted');

  assert.equal(h.state.canUseDeviceLocation, true);
  assert.equal(h.state.noticeOpen, false);
});

test('failed grant exposes error even with an older server grant', async t => {
  const h = harness();
  t.after(h.dispose);

  h.profile('station-1');
  h.consent('granted');

  assert.equal(h.state.canUseDeviceLocation, true);

  h.state.decide('granted');
  h.flush();

  assert.equal(h.state.savingConsent, true);
  assert.equal(h.state.noticeOpen, true);
  assert.equal(h.state.canUseDeviceLocation, false);

  h.writes[0].reject(new Error('simulated network failure'));
  await tick();
  h.flush();

  assert.equal(h.state.savingConsent, false);
  assert.equal(h.state.storageError, true);
  assert.equal(h.state.noticeOpen, true);
  assert.equal(
    h.state.canUseDeviceLocation,
    false,
    'An older grant cannot bypass a failed new consent request',
  );
});

test('rapid withdrawal supersedes a pending grant', async t => {
  const h = harness();
  t.after(h.dispose);

  h.profile('station-1');
  h.consent('granted');

  h.state.decide('granted');
  h.flush();

  assert.equal(h.writes.length, 1);
  assert.equal(h.state.savingConsent, true);

  h.state.decide('declined');
  h.flush();

  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].data.decision, 'declined');
  assert.equal(h.state.savingConsent, false);
  assert.equal(h.state.canUseDeviceLocation, false);

  // The old grant write finishes after the responder withdraws.
  h.writes[0].resolve();
  await tick();
  h.flush();

  h.consent('granted');

  assert.equal(
    h.state.canUseDeviceLocation,
    false,
    'Late grant acknowledgement must not undo local withdrawal',
  );

  h.writes[1].resolve();
  await tick();
  h.flush();

  h.consent('declined');

  assert.equal(h.state.canUseDeviceLocation, false);
  assert.equal(h.state.savingConsent, false);
});
