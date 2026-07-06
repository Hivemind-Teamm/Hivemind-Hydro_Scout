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
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      // A service worker left over from a previous local *prod* run (`next
      // start` on this same origin) keeps intercepting dev traffic and serves
      // `/_next/static/*` cache-first. Dev chunk URLs aren't content-hashed,
      // so the page silently runs whatever old code the SW cached — edits
      // appear to "revert". Actively unregister it and drop its caches so dev
      // always runs fresh code.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister();
      }).catch(() => {});
      if ('caches' in window) {
        caches.keys().then((keys) => {
          for (const key of keys) if (key.startsWith('hs-')) caches.delete(key);
        }).catch(() => {});
      }
      return;
    }
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((err) => console.error('Service worker registration failed:', err));
  }, []);

  return null;
}
