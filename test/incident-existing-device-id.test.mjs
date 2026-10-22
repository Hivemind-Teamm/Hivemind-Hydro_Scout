import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../lib/incident-device-id.ts', import.meta.url),
  'utf8',
);

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

function loadIdentity(windowValue) {
  const module = { exports: {} };

  const context = {
    module,
    exports: module.exports,
  };

  if (windowValue !== undefined) {
    context.window = windowValue;
  }

  vm.runInNewContext(compiled, context);

  return module.exports;
}

const UUID = '550e8400-e29b-41d4-a716-446655440000';

test('read-only lookup returns null when no browser exists', () => {
  const identity = loadIdentity(undefined);

  assert.equal(identity.getExistingIncidentDeviceId(), null);
});

test('read-only lookup never generates or stores an ID', () => {
  let generated = 0;
  let stored = 0;

  const identity = loadIdentity({
    localStorage: {
      getItem: () => null,
      setItem: () => { stored++; },
    },
    crypto: {
      randomUUID: () => {
        generated++;
        return UUID;
      },
    },
  });

  assert.equal(identity.getExistingIncidentDeviceId(), null);
  assert.equal(generated, 0);
  assert.equal(stored, 0);
});

test('read-only lookup returns an existing valid UUID', () => {
  const identity = loadIdentity({
    localStorage: {
      getItem: () => UUID,
      setItem: () => {
        throw new Error('Must not write to storage');
      },
    },
  });

  assert.equal(identity.getExistingIncidentDeviceId(), UUID);
});

test('read-only lookup does not replace an invalid UUID', () => {
  let stored = 0;
  let generated = 0;

  const identity = loadIdentity({
    localStorage: {
      getItem: () => 'invalid-device-id',
      setItem: () => { stored++; },
    },
    crypto: {
      randomUUID: () => {
        generated++;
        return UUID;
      },
    },
  });

  assert.equal(identity.getExistingIncidentDeviceId(), null);
  assert.equal(stored, 0);
  assert.equal(generated, 0);
});

test('read-only lookup handles blocked localStorage', () => {
  const identity = loadIdentity({
    localStorage: {
      getItem: () => {
        throw new Error('Storage blocked');
      },
    },
  });

  assert.equal(identity.getExistingIncidentDeviceId(), null);
});