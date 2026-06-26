'use client';

import { useEffect } from 'react';

type TimedEl = HTMLElement & { __scrollTimer?: ReturnType<typeof setTimeout> };

export default function ScrollBehavior() {
  useEffect(() => {
    const handler = (e: Event) => {
      const el = e.target as TimedEl;
      if (!el || el === document.documentElement || el === document.body) return;

      el.classList.add('is-scrolling');
      clearTimeout(el.__scrollTimer);
      el.__scrollTimer = setTimeout(() => el.classList.remove('is-scrolling'), 2000);
    };

    document.addEventListener('scroll', handler, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', handler, true);
  }, []);

  return null;
}
