import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);

const target = {
  responseId: '11111111-1111-4111-8111-111111111111',
  stationId: 'SYSTEM_ADMIN',
  stationName: 'System Administration',
  fireLat: 14.65,
  fireLng: 121.06,
};

const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function makeHarness() {
  const writes = [];
  const gps = [];
  const slots = [];
  const pending = [];
  const events = new Map();
  const savedGlobals = new Map();
  let cursor = 0;

  function listen(type, fn) {
    if (!events.has(type)) events.set(type, new Set());
    events.get(type).add(fn);
  }

  function unlisten(type, fn) {
    events.get(type)?.delete(fn);
  }

  function install(name, value) {
    savedGlobals.set(
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    );

    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  install('navigator', {
    onLine: true,
    geolocation: {
      getCurrentPosition(success) {
        gps.push(success);
      },
    },
  });

  install('window', {
    addEventListener: listen,
    removeEventListener: unlisten,
  });

  install('document', {
    visibilityState: 'visible',
    addEventListener: listen,
    removeEventListener: unlisten,
  });

  const react = {
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { ref: { current: initial } };
      }
      return slots[index].ref;
    },

    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];

      const changed =
        !previous ||
        deps.length !== previous.deps.length ||
        deps.some((value, i) =>
          !Object.is(value, previous.deps[i]),
        );

      if (changed) {
        pending.push({ index, effect, deps });
      }
    },

    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };

  const firestore = {
    doc(_db, ...parts) {
      return parts.join('/');
    },

    serverTimestamp() {
      return 'server-time';
    },

    writeBatch() {
      const operations = [];

      return {
        set(path, value) {
          operations.push({ kind: 'set', path, value });
        },

        delete(path) {
          operations.push({ kind: 'delete', path });
        },

        update(path, value) {
          operations.push({ kind: 'update', path, value });
        },

        commit() {
          const completion = deferred();
          writes.push({ operations, ...completion });
          return completion.promise;
        },
      };
    },
  };

  // Visibility-radius planning has separate existing unit tests.
  // This mock makes the hook attempt publication on every fresh,
  // unpublished state so race ordering can be tested independently.
  const visibility = {
    INITIAL_SHARING_STATE: {
      inside: null,
      published: null,
      lastPublishLat: null,
      lastPublishLng: null,
      lastPublishAt: 0,
      lastHeartbeatAt: 0,
    },

    RESPONSE_MIN_CHECK_MS: 10000,
    RESPONSE_RETRY_MS: 30000,

    planResponseSharing(state, coords) {
      const publish = state.published !== true;

      return {
        publish,
        remove: false,
        heartbeat: false,
        nextCheckMs: 60000,
        next: {
          ...state,
          inside: true,
          published: true,
          lastPublishLat: coords.lat,
          lastPublishLng: coords.lng,
        },
      };
    },
  };

  const source = readFileSync(
    'lib/use-response-location-sharing.ts',
    'utf8',
  );

  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

  const exports = {};

  const dependencies = {
    react,
    'firebase/firestore': firestore,
    './firebase': { db: {} },
    './haversine': { haversineM: () => 1 },
    './response-visibility': visibility,
  };

  const requireMock = id => {
    if (Object.hasOwn(dependencies, id)) {
      return dependencies[id];
    }
    return nativeRequire(id);
  };

  new Function('require', 'exports', compiled)(
    requireMock,
    exports,
  );

  function render(enabled) {
    cursor = 0;
    pending.length = 0;

    exports.useResponseLocationSharing(target, enabled);

    // Model React's cleanup-before-new-effect ordering.
    for (const item of pending) {
      slots[item.index]?.cleanup?.();
    }

    for (const item of pending) {
      const cleanup = item.effect();

      slots[item.index] = {
        deps: item.deps,
        cleanup,
      };
    }
  }

  function deliverGPS() {
    const resolve = gps.shift();
    assert.ok(resolve, 'Expected a pending GPS request');

    resolve({
      coords: {
        latitude: 14.65,
        longitude: 121.06,
        accuracy: 8,
      },
    });
  }

  function dispose() {
    for (const slot of slots) {
      slot?.cleanup?.();
    }

    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }

  return {
    render,
    deliverGPS,
    dispose,
    writes,
    gps,
  };
}

test('GPS result after withdrawal cannot publish a marker', async t => {
  const h = makeHarness();
  t.after(() => h.dispose());

  h.render(true);
  assert.equal(h.gps.length, 1);

  h.render(false);
  assert.equal(h.writes.length, 1);

  h.deliverGPS();
  await tick();

  assert.equal(
    h.writes.some(w =>
      w.operations.some(op => op.kind === 'set'),
    ),
    false,
    'A stopped GPS request must not publish',
  );

  h.writes[0].resolve();
  await tick();
});

test('pending publication completes before withdrawal deletion', async t => {
  const h = makeHarness();
  t.after(() => h.dispose());

  h.render(true);
  h.deliverGPS();
  await tick();

  assert.equal(h.writes.length, 1);
  assert.ok(
    h.writes[0].operations.some(op => op.kind === 'set'),
  );

  h.render(false);
  await tick();

  assert.equal(
    h.writes.length,
    1,
    'Deletion must wait for the pending publication',
  );

  h.writes[0].resolve();
  await tick();

  assert.equal(h.writes.length, 2);
  assert.equal(
    h.writes[1].operations.filter(op =>
      op.kind === 'delete',
    ).length,
    2,
  );

  h.writes[1].resolve();
  await tick();
});

test('rapid re-consent waits for deletion before republishing', async t => {
  const h = makeHarness();
  t.after(() => h.dispose());

  h.render(true);
  h.deliverGPS();
  await tick();

  assert.equal(h.writes.length, 1);
  h.writes[0].resolve();
  await tick();

  h.render(false);
  assert.equal(h.writes.length, 2);

  h.render(true);
  await tick();

  assert.equal(
    h.gps.length,
    0,
    'New GPS check must wait for pending cleanup',
  );

  h.writes[1].resolve();
  await tick();

  assert.equal(h.gps.length, 1);

  h.deliverGPS();
  await tick();

  assert.equal(h.writes.length, 3);
  assert.ok(
    h.writes[2].operations.some(op => op.kind === 'set'),
  );

  h.writes[2].resolve();
  await tick();
});