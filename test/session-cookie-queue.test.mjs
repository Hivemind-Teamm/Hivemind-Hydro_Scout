import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile('lib/auth-context.tsx', 'utf8');

const start = source.indexOf('let sessionCookieSyncQueue:');
const end = source.indexOf('export function AuthProvider');

assert.ok(start >= 0, 'Session queue not found.');
assert.ok(end > start, 'Expected AuthProvider boundary not found.');

const extracted = source.slice(start, end);

const compiled = ts.transpileModule(extracted, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;

function deferred() {
  let resolve;

  const promise = new Promise(done => {
    resolve = done;
  });

  return { promise, resolve };
}

function createHarness(fetchMock) {
  const context = {
    fetch: fetchMock,
    Promise,
    Error,
    JSON,
  };

  runInNewContext(
    `${compiled}
     globalThis.testSync = syncSessionCookie;`,
    context,
  );

  return context.testSync;
}

test('overlapping session requests execute sequentially', async () => {
  const gate = deferred();
  const started = [];

  const sync = createHarness(async (_url, options) => {
    const token = JSON.parse(options.body).idToken;
    started.push(token);

    if (token === 'first') {
      await gate.promise;
    }

    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  });

  const first = sync('first');
  const second = sync('second');
  const third = sync(null);

  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(started, ['first']);

  gate.resolve();

  await Promise.all([first, second, third]);

  assert.deepEqual(started, ['first', 'second', null]);
});

test('failed synchronization does not block later requests', async () => {
  const started = [];

  const sync = createHarness(async (_url, options) => {
    const token = JSON.parse(options.body).idToken;
    started.push(token);

    return {
      ok: token !== 'rejected',
      json: async () => ({ ok: token !== 'rejected' }),
    };
  });

  await assert.rejects(sync('rejected'));

  await sync('next');

  assert.deepEqual(started, ['rejected', 'next']);
});