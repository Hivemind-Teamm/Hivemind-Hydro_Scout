import type { NextConfig } from "next";
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { version } from './package.json';

function sourceCommit() {
  const supplied = process.env.VERCEL_GIT_COMMIT_SHA;
  if (supplied) return supplied;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function sourceState() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ? 'modified' : 'clean';
  } catch {
    return 'unknown';
  }
}

// Public, non-secret metadata embedded in the browser bundle at build time.
// A new identifier distinguishes rebuilds of the same source revision.
const buildId = process.env.HYDRO_BUILD_ID ||= randomUUID();
const builtAt = process.env.HYDRO_BUILT_AT ||= new Date().toISOString();

const nextConfig: NextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  serverExternalPackages: ['firebase-admin'],
  env: {
    NEXT_PUBLIC_BUILD_VERSION: version,
    NEXT_PUBLIC_BUILD_COMMIT: sourceCommit(),
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_BUILD_TIME: builtAt,
    NEXT_PUBLIC_BUILD_SOURCE_STATE: sourceState(),
  },
  async headers() {
    return [
      {
        // Never cache the service worker itself, so a new deploy's SW is always
        // fetched and can take over (it then updates the caches it manages).
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
