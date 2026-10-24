// Tripwires for the October 2026 login outage
// (docs/incidents/2026-10-25-login-outage.md). Emulator-free:
//   node --test test/production-guardrails.test.mjs
// If one of these fails, fix the cause; do not delete or loosen the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

test('Node.js is pinned to one major that firebase-admin supports', async () => {
  const pkg = await readJson('package.json');
  const admin = await readJson('node_modules/firebase-admin/package.json');
  const match = /^(\d+)\.x$/.exec(pkg.engines?.node ?? '');
  assert.ok(match, 'package.json engines.node must be pinned like "24.x" (Vercel uses it to pick the runtime).');

  const adminMinMajor = Number(/>=\s*(\d+)/.exec(admin.engines.node)?.[1]);
  assert.ok(Number(match[1]) >= adminMinMajor,
    `engines.node ${pkg.engines.node} is below firebase-admin's requirement ${admin.engines.node}.`);
});

// Vercel's runtime cannot require() ES modules even on Node 24; firebase-admin 14
// (jwks-rsa 4 -> ESM-only jose 6) failed there with ERR_REQUIRE_ESM. Load it the same way.
test('Firebase Admin loads without require(esm), as on Vercel', () => {
  for (const id of ['firebase-admin/app', 'firebase-admin/auth', 'firebase-admin/firestore']) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ['--no-experimental-require-module', '-e', `require(${JSON.stringify(id)})`], { stdio: 'pipe' }),
      `${id} needs require(esm), which Vercel does not provide. Pin a firebase-admin whose dependencies are CommonJS.`,
    );
  }
});

test('builds and dev servers run the server runtime check first', async () => {
  const { scripts } = await readJson('package.json');
  for (const hook of ['predev', 'prebuild']) {
    assert.match(scripts[hook] ?? '', /check-server-runtime\.mjs/, `${hook} must run scripts/check-server-runtime.mjs`);
  }
});

test('session route never trusts an unverified token', async () => {
  const source = await readFile('app/api/auth/session/route.ts', 'utf8');
  assert.match(source, /verifyIdToken\(/, 'ID tokens must be verified with Firebase Admin.');
  assert.match(source, /createSessionCookie\(/, 'Success requires a real session cookie.');
  for (const forbidden of [/base64url/, /decodeJwt/i, /\.split\(['"]\.['"]\)/, /fallback:\s*true/]) {
    assert.doesNotMatch(source, forbidden,
      `Unverified JWT handling (${forbidden}) is forbidden: it hid a broken server for four months.`);
  }
});

test('server faults are reported as 503, not as a rejected login', async () => {
  const source = await readFile('app/api/auth/session/route.ts', 'utf8');
  assert.match(source, /status: 503/);
  assert.match(source, /status: 401/);
});

test('Firestore rules and indexes deploy with main', async () => {
  const firebase = await readJson('firebase.json');
  assert.equal(firebase.firestore?.rules, 'firestore.rules');
  assert.equal(firebase.firestore?.indexes, 'firestore.indexes.json');

  const workflow = await readFile('.github/workflows/firebase-deploy.yml', 'utf8');
  assert.match(workflow, /firestore:rules,firestore:indexes/);
  assert.match(workflow, /branches:\s*\[main\]/);
});
