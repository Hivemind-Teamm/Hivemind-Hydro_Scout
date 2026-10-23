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
    // Retire registrations from the removed device-notification feature.
    // Match only its exact scope; preserve the app's offline worker.
    navigator.serviceWorker.getRegistrations().then(async registrations => {
      for (const registration of registrations) {
        if (registration.scope !== new URL('/push-notifications/', location.origin).href) continue;
        try {
          for (const notification of await registration.getNotifications()) notification.close();
          await (await registration.pushManager?.getSubscription())?.unsubscribe();
        }
        finally { await registration.unregister(); }
      }
    }).catch(() => {});
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key === 'hydroscout-push-device' || key?.startsWith('hydroscout-push-enabled:')) localStorage.removeItem(key);
      }
      indexedDB.deleteDatabase('hydroscout-push');
    } catch { /* Cleanup must not prevent the app from loading. */ }
    if (process.env.NODE_ENV !== 'production') {
      // A service worker left over from a previous local *prod* run (`next
      // start` on this same origin) keeps intercepting dev traffic and serves
      // `/_next/static/*` cache-first. Dev chunk URLs aren't content-hashed,
      // so the page silently runs whatever old code the SW cached — edits
      // appear to "revert". Actively unregister it and drop its caches so dev
      // always runs fresh code.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) {
          if (reg.active?.scriptURL === new URL('/sw.js', location.origin).href) reg.unregister();
        }
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
