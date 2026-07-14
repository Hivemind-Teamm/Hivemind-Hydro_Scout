/*
 * Hydro-Scout service worker — offline support.
 *
 * Goals:
 *  - App still boots with no connection (cache the HTML shell) → no browser
 *    "offline dinosaur" page on reload.
 *  - The lazily-loaded map chunk loads offline (cache Next's hashed JS/CSS) →
 *    no ChunkLoadError, the map component actually renders.
 *  - Map imagery you've already viewed shows offline (cache CARTO tiles).
 *
 * Firestore/Firebase requests are NOT cached here — the Firebase SDK has its own
 * IndexedDB offline cache (see lib/firebase.ts), so we let those pass through.
 *
 * Bump CACHE_VERSION on any change to this file so old caches are cleared on
 * activate. The file is served with `no-store` (see next.config.ts), so browsers
 * pick up a new version on the next load.
 */

// v4: cache-bust after the mobile perf work — guarantees no device keeps
// serving pre-fix chunks (or a stale offline shell pointing at them).
const CACHE_VERSION = 'v4';
const SHELL_CACHE = `hs-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `hs-assets-${CACHE_VERSION}`;
const TILE_CACHE = `hs-tiles-${CACHE_VERSION}`;

// Cap the tile cache so offline map imagery can't grow without bound.
const TILE_CACHE_LIMIT = 500;

self.addEventListener('install', (event) => {
  // Activate this version immediately rather than waiting for old tabs to close.
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Precache the shell so navigations work offline even if the user never
      // revisited '/' after the SW installed. Non-fatal if it fails (offline
      // install) — navigations still populate the cache network-first.
      await cache.add('/').catch(() => {});
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, ASSET_CACHE, TILE_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Trim a cache to at most `max` entries (oldest first). */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (let i = 0; i < keys.length - max; i++) {
    await cache.delete(keys[i]);
  }
}

/** Cache-first: serve from cache, else fetch and store. */
async function cacheFirst(request, cacheName, { limit } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Store successful or opaque (cross-origin no-cors) responses.
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    if (limit) trimCache(cacheName, limit);
  }
  return response;
}

/** Network-first: try network (and refresh cache), fall back to cache. */
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await cache.match(fallbackUrl);
      if (shell) return shell;
    }
    throw new Error('offline and not cached');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET; never touch API routes or auth (let them hit the network).
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API routes and anything that must stay fresh/server-authoritative.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  // Let Firebase/Firestore/Google requests pass straight through — the SDK
  // manages its own offline cache.
  if (
    /(^|\.)googleapis\.com$/.test(url.hostname) ||
    /(^|\.)firebaseio\.com$/.test(url.hostname) ||
    /(^|\.)firebase\.com$/.test(url.hostname) ||
    /(^|\.)gstatic\.com$/.test(url.hostname) ||
    /firestore/.test(url.hostname)
  ) {
    return;
  }

  // Map tiles (CARTO basemaps) → cache-first, capped.
  if (/basemaps\.cartocdn\.com$/.test(url.hostname)) {
    event.respondWith(cacheFirst(request, TILE_CACHE, { limit: TILE_CACHE_LIMIT }));
    return;
  }

  // Navigations (the HTML document) → network-first, fall back to cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/'));
    return;
  }

  // Same-origin static build output + public assets → cache-first (Next's
  // `/_next/static/*` files are content-hashed, so caching them is safe).
  if (url.origin === self.location.origin) {
    if (
      url.pathname.startsWith('/_next/static/') ||
      /\.(?:js|css|woff2?|png|jpg|jpeg|svg|gif|ico|webp)$/.test(url.pathname)
    ) {
      event.respondWith(cacheFirst(request, ASSET_CACHE));
      return;
    }
  }
});
