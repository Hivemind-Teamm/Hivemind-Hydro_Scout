import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { canReceiveStationPush } from '../functions/push-policy.mjs';

const token = 'test-registration-token-with-enough-length';
const devicePath = `pushDevices/${createHash('sha256').update(token).digest('hex')}`;

function apiHarness(initial = {}) {
  const records = new Map(Object.entries(initial));
  const ref = path => ({ path,
    get: async () => ({ exists: records.has(path), data: () => records.get(path), get: field => records.get(path)?.[field] }),
    set: async data => records.set(path, data),
  });
  const db = { doc: ref, collection: collection => ({ doc: id => ref(`${collection}/${id}`) }),
    runTransaction: async callback => callback({ get: reference => reference.get(), delete: reference => records.delete(reference.path) }),
  };
  const exports = {};
  const output = ts.transpileModule(readFileSync('app/api/push/devices/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, Response,
    require(name) {
      if (name === 'node:crypto') return { createHash };
      if (name === 'firebase-admin/auth') return { getAuth: () => ({ verifyIdToken: async value => {
        if (value === 'invalid') throw Error('invalid');
        return { uid: value };
      } }) };
      if (name === 'firebase-admin/firestore') return { getFirestore: () => db,
        FieldValue: { serverTimestamp: () => 'server-time' }, Timestamp: { fromMillis: value => value } };
      if (name === '@/lib/firebase-admin') return { adminApp: () => ({}) };
      if (name === '@/functions/push-policy.mjs') return { canReceiveStationPush };
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  const request = (uid, body = { token }) => new Request('https://hydro.example/api/push/devices', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${uid}` } : {}) },
    body: JSON.stringify(body),
  });
  return { ...exports, records, request };
}

test('device registration rejects unauthenticated callers and forged station authority', async () => {
  const api = apiHarness({ 'users/general': { role: 'general', stationId: 'one' } });
  assert.equal((await api.POST(api.request(null))).status, 401);
  assert.equal((await api.POST(api.request('invalid'))).status, 401);
  assert.equal((await api.POST(api.request('general', { token, role: 'admin', stationId: 'one' }))).status, 403);
  assert.equal(api.records.has(devicePath), false);
});

test('registration derives its station from the trusted profile and binds deletion to its owner', async () => {
  const api = apiHarness({ 'users/head': { accountType: 'person', role: 'head', stationId: 'one' } });
  assert.equal((await api.POST(api.request('head', { token, stationId: 'other' }))).status, 200);
  const saved = api.records.get(devicePath);
  assert.equal(saved.uid, 'head');
  assert.equal(saved.stationId, 'one');
  assert.equal(saved.updatedAt, 'server-time');
  assert.ok(saved.expiresAt > Date.now());
  assert.equal((await api.DELETE(api.request('another'))).status, 200);
  assert.equal(api.records.has(devicePath), true);
  assert.equal((await api.DELETE(api.request('head'))).status, 200);
  assert.equal(api.records.has(devicePath), false);
});

test('station account registration validates the index and actual account identity', async () => {
  const api = apiHarness({
    'stationAccountIndex/station': { stationId: 'one' },
    'stations/one/accounts/station': { uid: 'station', accountType: 'station', stationId: 'one' },
  });
  assert.equal((await api.POST(api.request('station'))).status, 200);
  api.records.set('stations/one/accounts/station', { uid: 'someone-else', accountType: 'station', stationId: 'one' });
  assert.equal((await api.POST(api.request('station'))).status, 403);
  api.records.set('stationAccountIndex/station', { stationId: '../users/admin' });
  assert.equal((await api.POST(api.request('station'))).status, 403);
});

test('invalid tokens are rejected without creating registrations', async () => {
  const api = apiHarness({ 'users/head': { role: 'head', stationId: 'one' } });
  for (const value of ['', 123, 'a'.repeat(4097), 'token with embedded spaces']) {
    assert.equal((await api.POST(api.request('head', { token: value }))).status, 400);
  }
  assert.equal(api.records.has(devicePath), false);
});
