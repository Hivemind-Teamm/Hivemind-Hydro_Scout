import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { canReceiveStationPush, stationPushContent } from '../functions/push-policy.mjs';

test('push recipients require current station management access', () => {
  assert.equal(canReceiveStationPush({ accountType: 'station', stationId: 'one' }, 'one'), true);
  assert.equal(canReceiveStationPush({ accountType: 'station', stationId: 'one' }, 'two'), false);
  assert.equal(canReceiveStationPush({ accountType: 'person', role: 'head', stationId: 'one' }, 'one'), true);
  assert.equal(canReceiveStationPush({ accountType: 'person', role: 'head', stationId: 'one' }, 'two'), false);
  assert.equal(canReceiveStationPush({ role: 'authorized', stationAccessIds: ['one'] }, 'one'), true);
  assert.equal(canReceiveStationPush({ role: 'authorized', stationAccessIds: [] }, 'one'), false);
  assert.equal(canReceiveStationPush({ role: 'general', stationId: 'one' }, 'one'), false);
  assert.equal(canReceiveStationPush({ role: 'admin' }, 'one'), true);
  assert.equal(canReceiveStationPush({ role: 'admin' }, null), false);
  assert.equal(canReceiveStationPush({ role: 'admin' }, 123), false);
});

test('operational response starts are high urgency; approvals stay normal', () => {
  assert.equal(stationPushContent('activity', 'response-started').urgency, 'high');
  assert.equal(stationPushContent('members', 'membership-request').urgency, 'normal');
  assert.equal(stationPushContent('activity', 'unknown'), null);
});

function workerHarness() {
  let boundUid = null;
  let background;
  const handlers = {};
  const notifications = [];
  const navigation = [];
  const db = { close() {}, transaction() {
    const transaction = { objectStore: () => ({
      get: () => ({ result: boundUid }),
      put: value => { boundUid = value; return { result: value }; },
    }) };
    queueMicrotask(() => transaction.oncomplete?.());
    return transaction;
  } };
  const self = {
    location: { origin: 'https://hydro.example' },
    addEventListener: (name, callback) => { handlers[name] = callback; },
    registration: { showNotification: async (...args) => notifications.push(args) },
    clients: { matchAll: async () => [], openWindow: async url => navigation.push(url) },
  };
  vm.runInNewContext(readFileSync('public/firebase-messaging-sw.js', 'utf8'), {
    self, URL, importScripts() {},
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: callback => { background = callback; } }) },
    indexedDB: { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } },
  });
  return { notifications, navigation, background: payload => background(payload),
    async bind(uid) {
      let completion;
      handlers.message({ data: { type: 'PUSH_ACCOUNT', uid }, ports: [{ postMessage() {} }], waitUntil: promise => { completion = promise; } });
      await completion;
    },
    async click(data) {
      let completion;
      handlers.notificationclick({ notification: { data, close() {} }, stopImmediatePropagation() {}, waitUntil: promise => { completion = promise; } });
      await completion;
    },
  };
}

test('background alerts display only for the bound account and stop after logout', async () => {
  const worker = workerHarness();
  const payload = { data: { uid: 'head-one', title: 'Response started', body: 'Open the app', kind: 'activity', tag: 'event-one' } };
  await worker.background(payload);
  assert.equal(worker.notifications.length, 0);
  await worker.bind('head-one');
  await worker.background(payload);
  assert.equal(worker.notifications.length, 1);
  await worker.bind('head-two');
  await worker.background(payload);
  assert.equal(worker.notifications.length, 1);
  await worker.bind(null);
  await worker.background(payload);
  assert.equal(worker.notifications.length, 1);
});

test('notification clicks open the correct same-origin list and ignore stale account alerts', async () => {
  const worker = workerHarness();
  await worker.bind('head-one');
  await worker.click({ uid: 'head-two', kind: 'members' });
  assert.equal(worker.navigation.length, 0);
  await worker.click({ uid: 'head-one', kind: 'members', url: 'https://evil.example' });
  assert.equal(worker.navigation[0], 'https://hydro.example/dashboard?notifications=members');
  await worker.click({ uid: 'head-one', kind: 'activity' });
  assert.equal(worker.navigation[1], 'https://hydro.example/dashboard?notifications=activity');
});
