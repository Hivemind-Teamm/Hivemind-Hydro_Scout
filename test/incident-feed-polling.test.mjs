import test from "node:test";
import assert from "node:assert/strict";
import { createIncidentFeedPollingController } from "../lib/incident-feed-polling.mjs";

const incident = { id: "fire-001", lat: 14.65, lng: 121.06 };

function fakeClock() {
  let nextId = 0;
  const timers = new Map();

  return {
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fire(delay) {
      const match = [...timers.entries()].find(
        ([, timer]) => timer.delay === delay
      );

      assert.ok(match, `Expected timer with delay ${delay}`);

      const [id, timer] = match;
      timers.delete(id);
      timer.callback();
    },
    count(delay) {
      return [...timers.values()].filter(
        timer => timer.delay === delay
      ).length;
    },
  };
}

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function response(incidents, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    json: async () => ({ incidents }),
  };
}

test("Publishes verified assignments and schedules another poll", async () => {
  const clock = fakeClock();
  const states = [];
  let requests = 0;

  const controller = createIncidentFeedPollingController({
    fetchFeed: async () => {
      requests++;
      return response([incident]);
    },
    onChange: state => states.push(state),
    intervalMs: 5000,
    timeoutMs: 4000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  controller.start();
  await flush();

  assert.equal(requests, 1);
  assert.deepEqual(states.at(-1), {
    incidents: [incident],
    verified: true,
    error: null,
  });
  assert.equal(clock.count(5000), 1);

  clock.fire(5000);
  await flush();

  assert.equal(requests, 2);
  assert.equal(clock.count(5000), 1);

  controller.stop();

  assert.equal(controller.running, false);
  assert.equal(clock.count(5000), 0);
  assert.equal(clock.count(4000), 0);
});

test("Clears earlier assignments on server failure", async () => {
  const clock = fakeClock();
  const states = [];
  let requests = 0;

  const controller = createIncidentFeedPollingController({
    fetchFeed: async () => {
      requests++;
      return requests === 1
        ? response([incident])
        : response([], 503);
    },
    onChange: state => states.push(state),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  controller.start();
  await flush();

  assert.equal(states.at(-1).verified, true);

  clock.fire(5000);
  await flush();

  assert.deepEqual(states.at(-1), {
    incidents: [],
    verified: false,
    error: "incident-feed-unavailable",
  });

  controller.stop();
});

test("Malformed responses invalidate earlier assignments", async () => {
  const clock = fakeClock();
  const states = [];
  let requests = 0;

  const controller = createIncidentFeedPollingController({
    fetchFeed: async () => {
      requests++;
      return requests === 1
        ? response([incident])
        : response([{ id: "bad", lat: 999, lng: 121.06 }]);
    },
    onChange: state => states.push(state),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  controller.start();
  await flush();

  assert.equal(states.at(-1).verified, true);

  clock.fire(5000);
  await flush();

  assert.deepEqual(states.at(-1), {
    incidents: [],
    verified: false,
    error: "incident-feed-unavailable",
  });

  controller.stop();
});

test("Ignores late responses from a stopped session", async () => {
  const clock = fakeClock();
  const states = [];
  const firstRequest = deferred();
  let requests = 0;
  let oldSignal;

  const controller = createIncidentFeedPollingController({
    fetchFeed: async signal => {
      requests++;

      if (requests === 1) {
        oldSignal = signal;
        return firstRequest.promise;
      }

      return response([]);
    },
    onChange: state => states.push(state),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  controller.start();
  assert.equal(requests, 1);

  controller.stop();

  assert.equal(oldSignal.aborted, true);

  controller.start();
  await flush();

  assert.equal(requests, 2);
  assert.deepEqual(states.at(-1), {
    incidents: [],
    verified: true,
    error: null,
  });

  const countBeforeLateResponse = states.length;

  firstRequest.resolve(response([incident]));
  await flush();

  assert.equal(states.length, countBeforeLateResponse);
  assert.equal(clock.count(5000), 1);

  controller.stop();
});

test("Stopping clears pending polling and aborts the request", async () => {
  const clock = fakeClock();
  const states = [];
  const pending = deferred();
  let signal;

  const controller = createIncidentFeedPollingController({
    fetchFeed: async requestSignal => {
      signal = requestSignal;
      return pending.promise;
    },
    onChange: state => states.push(state),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  controller.start();

  assert.equal(controller.running, true);
  assert.equal(clock.count(4000), 1);

  controller.stop();

  assert.equal(signal.aborted, true);
  assert.equal(clock.count(4000), 0);
  assert.equal(clock.count(5000), 0);

  const stateCount = states.length;

  pending.resolve(response([incident]));
  await flush();

  assert.equal(states.length, stateCount);
  assert.equal(clock.count(5000), 0);
});
test("A hung request times out and polling continues", async () => {
  const clock = fakeClock();
  const states = [];
  const hangingRequest = deferred();

  let requests = 0;
  let hangingSignal;

  const controller = createIncidentFeedPollingController({
    fetchFeed: async signal => {
      requests++;

      if (requests === 2) {
        hangingSignal = signal;
        // Deliberately ignores AbortSignal.
        return hangingRequest.promise;
      }

      return response([incident]);
    },
    onChange: state => states.push(state),
    intervalMs: 5000,
    timeoutMs: 4000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  try {
    // First poll succeeds and authorizes an incident.
    controller.start();
    await flush();

    assert.equal(requests, 1);
    assert.equal(states.at(-1).verified, true);

    // Second poll hangs indefinitely.
    clock.fire(5000);
    await flush();

    assert.equal(requests, 2);
    assert.equal(clock.count(4000), 1);

    // The request's abort signal fires after four seconds.
    clock.fire(4000);
    await flush();

    assert.equal(hangingSignal.aborted, true);

    // Timeout must revoke the previously verified assignment.
    assert.deepEqual(states.at(-1), {
      incidents: [],
      verified: false,
      error: "incident-feed-unavailable",
    });

    // A new polling attempt must be scheduled.
    assert.equal(clock.count(5000), 1);

    clock.fire(5000);
    await flush();

    assert.equal(requests, 3);
    assert.equal(states.at(-1).verified, true);
  } finally {
    controller.stop();

    // Settle the deliberately hung promise to avoid dangling work.
    hangingRequest.resolve(response([incident]));
    await flush();
  }
});

test("Late timed-out responses cannot override newer assignments", async () => {
  const clock = fakeClock();
  const states = [];
  const oldRequest = deferred();
  let requests = 0;

  const controller = createIncidentFeedPollingController({
    fetchFeed: async () => {
      requests++;

      // First request hangs and ignores cancellation.
      if (requests === 1) {
        return oldRequest.promise;
      }

      // Second request verifies that no incidents are assigned.
      return response([]);
    },
    onChange: state => states.push(state),
    intervalMs: 5000,
    timeoutMs: 4000,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  try {
    controller.start();

    assert.equal(requests, 1);

    // Force the first request to time out.
    clock.fire(4000);
    await flush();

    assert.deepEqual(states.at(-1), {
      incidents: [],
      verified: false,
      error: "incident-feed-unavailable",
    });

    // Start a newer request.
    clock.fire(5000);
    await flush();

    assert.equal(requests, 2);
    assert.deepEqual(states.at(-1), {
      incidents: [],
      verified: true,
      error: null,
    });

    // The old request finally returns an obsolete assignment.
    const stateCount = states.length;

    oldRequest.resolve(response([incident]));
    await flush();

    // Obsolete data must never overwrite the newer result.
    assert.equal(states.length, stateCount);
    assert.deepEqual(states.at(-1), {
      incidents: [],
      verified: true,
      error: null,
    });

    // Exactly one future poll should remain scheduled.
    assert.equal(clock.count(5000), 1);
    assert.equal(clock.count(4000), 0);
  } finally {
    controller.stop();
    oldRequest.resolve(response([]));
    await flush();
  }
});

test("Expired verification revokes an assigned incident", async () => {
  const clock = fakeClock();
  const states = [];

  const controller = createIncidentFeedPollingController({
    fetchFeed: async () => response([incident]),
    onChange: state => states.push(state),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  try {
    controller.start();
    await flush();

    assert.equal(states.at(-1).verified, true);
    assert.equal(states.at(-1).incidents.length, 1);
    assert.equal(clock.count(15000), 1);

    // Simulate delayed polling: the expiry deadline fires first.
    clock.fire(15000);

    assert.deepEqual(states.at(-1), {
      incidents: [],
      verified: false,
      error: "incident-feed-expired",
    });

    // A fresh successful server response may restore verification.
    clock.fire(5000);
    await flush();

    assert.equal(states.at(-1).verified, true);
    assert.deepEqual(states.at(-1).incidents, [incident]);
    assert.equal(clock.count(15000), 1);
  } finally {
    controller.stop();
  }

  assert.equal(clock.count(15000), 0);
});

test("Fresh verification replaces the old expiry deadline", async () => {
  const clock = fakeClock();
  const states = [];

  const controller = createIncidentFeedPollingController({
    fetchFeed: async () => response([incident]),
    onChange: state => states.push(state),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  try {
    controller.start();
    await flush();

    assert.equal(clock.count(15000), 1);

    // A timely follow-up verification renews the deadline.
    clock.fire(5000);
    await flush();

    assert.equal(states.at(-1).verified, true);
    assert.equal(clock.count(15000), 1);

    // Expiry must still revoke the latest verified assignment.
    clock.fire(15000);

    assert.deepEqual(states.at(-1), {
      incidents: [],
      verified: false,
      error: "incident-feed-expired",
    });
  } finally {
    controller.stop();
  }

  assert.equal(clock.count(15000), 0);
});