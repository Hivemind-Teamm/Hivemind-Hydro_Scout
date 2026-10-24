// check-server-runtime.mjs
// Runs before `npm run dev` and `npm run build` (Vercel builds included) and
// stops them when the server would be unable to verify logins:
//
//   1. Node.js must match package.json "engines.node" (Vercel uses the same).
//   2. firebase-admin's app/auth/firestore modules must load WITHOUT require()
//      of ES modules. Vercel's function runtime cannot require() ESM even on
//      Node 24, so firebase-admin 14 (jwks-rsa 4 -> ESM-only jose 6) broke every
//      login there with ERR_REQUIRE_ESM while working locally (the October 2026
//      outage, see docs/incidents/2026-10-25-login-outage.md).
//   3. Production Vercel builds need a FIREBASE_SERVICE_ACCOUNT_KEY that parses
//      and belongs to the Firebase project in .firebaserc.
//
// Prints no secret values. Do not weaken or skip this check to get a build through.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const failures = [];

const wanted = readJson("../package.json").engines?.node;
const wantedMajor = /^(\d+)\.x$/.exec(wanted ?? "")?.[1];
const actualMajor = process.versions.node.split(".")[0];
if (!wantedMajor) {
  failures.push(`package.json "engines.node" must be a major version like "24.x" (found ${JSON.stringify(wanted)}).`);
} else if (actualMajor !== wantedMajor) {
  failures.push(
    `Node.js ${process.versions.node} is running but package.json requires ${wanted}. ` +
    `Switch Node (e.g. "nvm use ${wantedMajor}"); change engines.node only together with a tested firebase-admin/next upgrade.`,
  );
}

for (const id of ["firebase-admin/app", "firebase-admin/auth", "firebase-admin/firestore"]) {
  try {
    execFileSync(process.execPath, ["--no-experimental-require-module", "-e", `require(${JSON.stringify(id)})`], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch (err) {
    const output = String(err.stderr || err.message);
    const reason = output.split("\n").find((line) => /\bERR_|Error\b/.test(line))?.trim() ?? output.trim();
    failures.push(`Cannot load ${id} without require(esm), as on Vercel: ${reason.slice(0, 300)}`);
  }
}

if (process.env.VERCEL_ENV === "production") {
  const expectedProject = readJson("../.firebaserc").projects?.default;
  let key = null;
  try {
    key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "");
  } catch {
    // Reported below without echoing the value.
  }
  if (!key || typeof key.private_key !== "string" || typeof key.client_email !== "string") {
    failures.push("FIREBASE_SERVICE_ACCOUNT_KEY is missing or is not a service-account JSON in the Vercel Production environment.");
  } else if (key.project_id !== expectedProject) {
    failures.push(`FIREBASE_SERVICE_ACCOUNT_KEY is for project "${key.project_id}", but .firebaserc expects "${expectedProject}".`);
  }
}

if (failures.length) {
  console.error("\n[check-server-runtime] The server could not verify logins with this setup:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("");
  process.exit(1);
}

const adminVersion = readJson("../node_modules/firebase-admin/package.json").version;
console.log(`[check-server-runtime] OK: Node.js ${process.versions.node}, firebase-admin ${adminVersion}`);
