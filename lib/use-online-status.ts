'use client';

import { useState, useEffect } from 'react';

export type ConnectionState = 'online' | 'offline' | 'weak';

/** Minimal shape of the (non-standard) Network Information API. */
interface NetworkInformationLike {
  effectiveType?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/**
 * Tracks the browser's connectivity so the UI can reassure users that cached
 * hydrant data is still usable while offline.
 *
 * Combines three signals:
 *  - `navigator.onLine` + the `online`/`offline` events for hard disconnects.
 *  - The Network Information API (`connection.effectiveType`, when available) to
 *    flag `slow-2g`/`2g` links as `'weak'`.
 *  - A periodic lightweight fetch to catch "connected to Wi-Fi but no real
 *    internet" cases that `navigator.onLine` misses.
 *
 * SSR-safe: the dashboard is fully client-rendered behind the auth gate, so
 * seeding from `navigator` on the client is fine.
 */
export function useOnlineStatus(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  );

  useEffect(() => {
    let cancelled = false;

    const nav =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & {
            connection?: NetworkInformationLike;
            mozConnection?: NetworkInformationLike;
            webkitConnection?: NetworkInformationLike;
          })
        : undefined;
    const conn: NetworkInformationLike | undefined =
      nav?.connection ?? nav?.mozConnection ?? nav?.webkitConnection;

    const isWeakLink = () => {
      const t = conn?.effectiveType;
      return t === 'slow-2g' || t === '2g';
    };

    const compute = () => {
      if (cancelled) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setState('offline');
      } else if (isWeakLink()) {
        setState('weak');
      } else {
        setState('online');
      }
    };

    // Active reachability probe — `navigator.onLine === true` only means the
    // device has a network interface, not that the internet is reachable.
    const probe = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        compute();
        return;
      }
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        // Same-origin, cache-busted; `HEAD` keeps it cheap.
        await fetch(`/favicon.ico?_=${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!cancelled) setState(isWeakLink() ? 'weak' : 'online');
      } catch {
        if (!cancelled) setState('offline');
      }
    };

    compute();
    probe();

    window.addEventListener('online', compute);
    window.addEventListener('offline', compute);
    conn?.addEventListener?.('change', compute);
    const interval = setInterval(probe, 20000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', compute);
      window.removeEventListener('offline', compute);
      conn?.removeEventListener?.('change', compute);
      clearInterval(interval);
    };
  }, []);

  return state;
}
