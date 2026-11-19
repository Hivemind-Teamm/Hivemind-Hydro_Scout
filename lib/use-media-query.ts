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
 * True for phone-sized screens in either orientation, as well as a desktop
 * browser window that has been reduced to the same usable viewport. This
 * keeps a narrow portrait window on the portrait UI and a short, constrained
 * landscape window on the landscape UI instead of letting desktop chrome
 * collide with itself.
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(orientation: portrait) and (max-width: 900px), (pointer: coarse) and (max-height: 900px), (orientation: landscape) and (max-height: 719px) and (max-width: 1180px)');
}

/**
 * True on short viewports (< 720px tall) — e.g. iPhone SE (667px) or a phone in
 * landscape. Lets full-height layouts (auth pages) tighten spacing so they fit
 * without scrolling.
 */
export function useIsShort(): boolean {
  return useMediaQuery('(max-height: 719px)');
}

/** A touch-first or compact browser viewport in landscape. */
export function useIsMobileLandscape(): boolean {
  return useMediaQuery('(pointer: coarse) and (orientation: landscape), (orientation: landscape) and (max-height: 719px) and (max-width: 1180px)');
}
