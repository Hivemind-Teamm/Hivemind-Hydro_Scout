
// scripts/check-server-runtime.mjs
//
// Runs before npm run dev and npm run build, including Vercel builds.
//
// Security checks:
// 1. Verify the required Node.js version.
// 2. Verify Firebase Admin modules load in the server runtime.
// 3. Validate the selected Firebase deployment target.
// 4. Prevent the dedicated staging Vercel project from selecting production.
// 5. Verify the service-account credentials match the selected project.
//
// Never bypass these checks or print credential contents.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const readJson = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const failures = [];

/* -------------------------------------------------------------------------- */
/* 1. Node.js version validation                                               */
/* -------------------------------------------------------------------------- */

const wanted = readJson("../package.json").engines?.node;
const wantedMajor = /^(\d+)\.x$/.exec(wanted ?? "")?.[1];
const actualMajor = process.versions.node.split(".")[0];

if (!wantedMajor) {
  failures.push(
    `package.json "engines.node" must be a major version like "24.x" (found ${JSON.stringify(wanted)}).`,
  );
} else if (actualMajor !== wantedMajor) {
  failures.push(
    `Node.js ${process.versions.node} is running but package.json requires ${wanted}. ` +
      `Switch Node (e.g. "nvm use ${wantedMajor}"); change engines.node only together with a tested firebase-admin/next upgrade.`,
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Firebase Admin runtime compatibility                                      */
/* -------------------------------------------------------------------------- */

// Firebase Admin 14 previously caused a Vercel authentication outage.
// Keep using the tested firebase-admin 13.10.0 dependency.
for (const id of [
  "firebase-admin/app",
  "firebase-admin/auth",
  "firebase-admin/firestore",
]) {
  try {
    require(id);
  } catch (err) {
    failures.push(
      `Cannot load ${id} on Node.js ${process.versions.node}: ` +
        `${err.code ?? ""} ${String(err.message).split("\n")[0]}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Dedicated Vercel staging project safeguard                                */
/* -------------------------------------------------------------------------- */

const STAGING_VERCEL_PROJECT_ID =
  "prj_SgPIc3mdclnebW25DdBYQz1WSulz";

const isStagingVercelProject =
  process.env.VERCEL_PROJECT_ID === STAGING_VERCEL_PROJECT_ID;

const target = process.env.NEXT_PUBLIC_FIREBASE_TARGET;
const deploymentMarker = process.env.HYDROSCOUT_DEPLOYMENT;

if (isStagingVercelProject) {
  if (target !== "staging") {
    failures.push(
      "Staging Vercel project must explicitly use staging Firebase.",
    );
  }

  if (deploymentMarker !== "staging") {
    failures.push(
      "Staging Vercel project is missing its staging deployment marker.",
    );
  }
}

// Reject a staging deployment marker on a different Vercel project.
// This helps prevent accidental cross-project configuration.
if (
  process.env.VERCEL &&
  deploymentMarker === "staging" &&
  !isStagingVercelProject
) {
  failures.push(
    "Staging deployment marker does not match the approved Vercel project.",
  );
}

// Reject production target selection on the dedicated staging project.
if (isStagingVercelProject && target === "production") {
  failures.push(
    "Production Firebase cannot be selected by the staging Vercel project.",
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Firebase deployment credentials                                           */
/* -------------------------------------------------------------------------- */

// Separate Vercel projects may each use VERCEL_ENV=production.
// Determine the expected Firebase project from the explicit target.
if (process.env.VERCEL) {
  if (
    target !== undefined &&
    target !== "production" &&
    target !== "staging"
  ) {
    failures.push("Invalid NEXT_PUBLIC_FIREBASE_TARGET.");
  }

  const projects = readJson("../.firebaserc").projects;

  const expectedProject =
    target === "staging"
      ? projects?.staging
      : projects?.default;

  if (target === "staging") {
    if (expectedProject !== "hydro-scout-staging") {
      failures.push("Staging Firebase project alias is incorrect.");
    }

    if (!process.env.NEXT_PUBLIC_STAGING_FIREBASE_API_KEY) {
      failures.push("Missing staging Firebase web API key.");
    }
  } else if (expectedProject !== "hydro-scout") {
    failures.push("Production Firebase project alias is incorrect.");
  }

  // Keep the existing production service-account check.
  // Also verify staging builds, including Vercel previews.
  let key = null;

  try {
    key = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "",
    );
  } catch {
    // Missing or invalid credentials are reported without exposing values.
  }

  if (
    !key ||
    typeof key.private_key !== "string" ||
    typeof key.client_email !== "string"
  ) {
    failures.push(
      "FIREBASE_SERVICE_ACCOUNT_KEY is missing or invalid.",
    );
  } else if (key.project_id !== expectedProject) {
    failures.push(
      "Firebase service account does not match the selected deployment project.",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Fail closed                                                               */
/* -------------------------------------------------------------------------- */

if (failures.length) {
  console.error(
    "\n[check-server-runtime] The server could not verify logins with this setup:",
  );

  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }

  console.error("");
  process.exit(1);
}

const adminVersion = readJson(
  "../node_modules/firebase-admin/package.json",
).version;

console.log(
  `[check-server-runtime] OK: Node.js ${process.versions.node}, firebase-admin ${adminVersion}`,
);
