'use client';

import { useState, useEffect } from 'react';

/**
 * Subscribe to a CSS media query. SSR-safe: initialises from `window` when
 * available (the dashboard is fully client-rendered behind the auth gate, so
 * there's no hydration mismatch risk) and updates live on viewport changes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * True for phone-sized screens in either orientation. A landscape phone can
 * be wider than 767 CSS pixels, but still has a short, touch-first viewport.
 * Keep it on the mobile dashboard instead of exposing the desktop overlay.
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px), (pointer: coarse) and (max-height: 900px)');
}

/**
 * True on short viewports (< 720px tall) — e.g. iPhone SE (667px) or a phone in
 * landscape. Lets full-height layouts (auth pages) tighten spacing so they fit
 * without scrolling.
 */
export function useIsShort(): boolean {
  return useMediaQuery('(max-height: 719px)');
}

/** A touch-first device in landscape, including Android and iOS phones. */
export function useIsMobileLandscape(): boolean {
  return useMediaQuery('(pointer: coarse) and (orientation: landscape)');
}
