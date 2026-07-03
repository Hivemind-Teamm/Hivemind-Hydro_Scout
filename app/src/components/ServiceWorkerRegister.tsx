'use client';

import { useEffect } from 'react';

/**
 * Registers the offline service worker (public/sw.js).
 *
 * Production-only: in dev, Next rebuilds chunks on every edit and a cache-first
 * service worker would serve stale/removed chunks and fight Fast Refresh. The
 * SW is served with `no-store` (next.config.ts) and registered with
 * `updateViaCache: 'none'`, so a new deploy is picked up on the next load.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((err) => console.error('Service worker registration failed:', err));
  }, []);

  return null;
}
