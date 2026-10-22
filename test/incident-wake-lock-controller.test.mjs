import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentWakeLockController } from '../lib/incident-wake-lock-controller.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));

function createHarness() {
  let visible = true;
  let requests = 0;
  const locks = [];
  const states = [];

  const request = async () => {
    requests++;
    const listeners = new Map();
    const lock = {
      released: false,
      addEventListener(event, listener) {
        listeners.set(event, listener);
      },
      async release() {
        this.released = true;
        listeners.get('release')?.();
      },
    };
    locks.push(lock);
    return lock;
  };

  const controller = createIncidentWakeLockController({
    request,
    isVisible: () => visible,
    onChange: held => states.push(held),
  });

  return {
    controller,
    locks,
    states,
    requests: () => requests,
    setVisible: value => { visible = value; },
  };
}

test('acquires a wake lock when started and visible', async () => {
  const h = createHarness();
  h.controller.start();
  await flush();

  assert.equal(h.requests(), 1);
  assert.equal(h.states.at(-1), true);
  h.controller.stop();
});

test('releases the wake lock when page becomes hidden', async () => {
  const h = createHarness();
  h.controller.start();
  await flush();

  h.setVisible(false);
  h.controller.visibilityChanged();
  await flush();

  assert.equal(h.locks[0].released, true);
  assert.equal(h.states.at(-1), false);
  h.controller.stop();
});

test('reacquires the wake lock when page becomes visible again', async () => {
  const h = createHarness();
  h.controller.start();
  await flush();

  h.setVisible(false);
  h.controller.visibilityChanged();
  await flush();

  h.setVisible(true);
  h.controller.visibilityChanged();
  await flush();

  assert.equal(h.requests(), 2);
  assert.equal(h.states.at(-1), true);
  h.controller.stop();
});

test('unexpected release triggers reacquisition', async () => {
  const h = createHarness();
  h.controller.start();
  await flush();

  await h.locks[0].release();
  await flush();

  assert.equal(h.requests(), 2);
  assert.equal(h.states.at(-1), true);
  h.controller.stop();
});

test('stop releases the lock and prevents further requests', async () => {
  const h = createHarness();
  h.controller.start();
  await flush();

  h.controller.stop();
  await flush();

  const before = h.requests();
  h.controller.visibilityChanged();
  await flush();

  assert.equal(h.locks[0].released, true);
  assert.equal(h.requests(), before);
});

test('does not request a lock while page starts hidden', async () => {
  const h = createHarness();
  h.setVisible(false);

  h.controller.start();
  await flush();

  assert.equal(h.requests(), 0);

  h.setVisible(true);
  h.controller.visibilityChanged();
  await flush();

  assert.equal(h.requests(), 1);
  h.controller.stop();
});

test('visibility changes during a pending request reacquire correctly', async () => {
  let visible = true;
  let resolveFirst;
  let requests = 0;
  const locks = [];

  const makeLock = () => {
    const lock = {
      released: false,
      addEventListener() {},
      async release() { this.released = true; },
    };
    locks.push(lock);
    return lock;
  };

  const controller = createIncidentWakeLockController({
    isVisible: () => visible,
    request: () => {
      requests++;
      if (requests === 1) {
        return new Promise(resolve => { resolveFirst = resolve; });
      }
      return Promise.resolve(makeLock());
    },
  });

  controller.start();

  // Move to background and return before the first request finishes.
  visible = false;
  controller.visibilityChanged();

  visible = true;
  controller.visibilityChanged();

  // The outdated request must be released, not treated as the active lock.
  const outdatedLock = makeLock();
  resolveFirst(outdatedLock);
  await flush();
  await flush();

  assert.equal(outdatedLock.released, true);
  assert.equal(requests, 2);

  controller.stop();
});
