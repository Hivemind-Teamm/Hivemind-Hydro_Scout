import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(
  new URL('../lib/incident-device-id.ts', import.meta.url),
  'utf8',
);

const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const VALID_UUID = '123e4567-e89b-42d3-a456-426614174000';
const SECOND_UUID = '123e4567-e89b-42d3-a456-426614174001';

function harness({
  stored = null,
  generated = VALID_UUID,
  storageFails = false,
  cryptoAvailable = true,
} = {}) {
  let value = stored;
  let generations = 0;
  const storage = {
    getItem() {
      if (storageFails) throw new Error('Storage unavailable');
      return value;
    },
    setItem(_key, next) {
      if (storageFails) throw new Error('Storage unavailable');
      value = next;
    },
  };
  const window = {
    localStorage: storage,
    crypto: cryptoAvailable ? {
      randomUUID() {
        generations++;
        return generated;
      },
    } : {},
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    window,
  });
  return {
    getId: module.exports.getIncidentDeviceId,
    storedValue: () => value,
    generations: () => generations,
  };
}

test('creates and persists a valid UUID', () => {
  const h = harness();
  assert.equal(h.getId(), VALID_UUID);
  assert.equal(h.storedValue(), VALID_UUID);
  assert.equal(h.generations(), 1);
});

test('reuses the stored UUID without generating another', () => {
  const h = harness({ stored: VALID_UUID, generated: SECOND_UUID });
  assert.equal(h.getId(), VALID_UUID);
  assert.equal(h.getId(), VALID_UUID);
  assert.equal(h.generations(), 0);
});

test('replaces a malformed stored identifier', () => {
  const h = harness({ stored: 'not-a-uuid' });
  assert.equal(h.getId(), VALID_UUID);
  assert.equal(h.storedValue(), VALID_UUID);
});

test('fails closed when localStorage is unavailable', () => {
  const h = harness({ storageFails: true });
  assert.equal(h.getId(), null);
});

test('fails closed when secure UUID generation is unavailable', () => {
  const h = harness({ cryptoAvailable: false });
  assert.equal(h.getId(), null);
});

test('rejects an invalid generated UUID', () => {
  const h = harness({ generated: 'invalid' });
  assert.equal(h.getId(), null);
  assert.equal(h.storedValue(), null);
});
