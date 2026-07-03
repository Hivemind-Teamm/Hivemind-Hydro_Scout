import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  serverExternalPackages: ['firebase-admin'],
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