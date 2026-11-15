'use client';

import { useEffect, useState } from 'react';
import type { PerfRecord } from '@/lib/perf';

function lastP2Record(): PerfRecord | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem('hsPerfLog') ?? '[]');
    if (!Array.isArray(saved)) return null;
    return [...saved].reverse().find((record): record is PerfRecord => record?.measure === 'P2') ?? null;
  } catch {
    return null;
  }
}

/** Visible P2 result for phone testing, where DevTools is not normally open. */
export default function PerfReadout() {
  const [p2, setP2] = useState<PerfRecord | null>(() =>
    typeof window === 'undefined' ? null : lastP2Record(),
  );

  useEffect(() => {
    const onRecord = (event: Event) => {
      const record = (event as CustomEvent<PerfRecord>).detail;
      if (record?.measure === 'P2') setP2(record);
    };
    window.addEventListener('hs-perf-record', onRecord);
    return () => window.removeEventListener('hs-perf-record', onRecord);
  }, []);

  if (!p2 || typeof p2.ms !== 'number') return null;
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-[3500] rounded-lg border border-cyan-300/60 bg-slate-950/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur">
      <span className="font-black tracking-wide text-cyan-300">P2 READY</span>
      <span className="ml-2 font-bold">{p2.ms.toFixed(1)} ms</span>
      <span className="ml-2 text-slate-300">{p2.hydrantsDrawn ?? 0} hydrants · {p2.cacheMode ?? 'unknown'} cache</span>
    </div>
  );
}
