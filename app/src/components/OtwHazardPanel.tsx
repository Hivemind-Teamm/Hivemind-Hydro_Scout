'use client';

import { type Hydrant } from '../data/hydrants';

interface OtwHazardPanelProps {
  hazards: Hydrant[];
  onSelectHydrant: (hydrant: Hydrant) => void;
}

const HAZARD_META: Record<string, { label: string; color: string; icon: string }> = {
  out:     { label: 'Out of Service',   color: '#9aa0a6', icon: '🚫' },
  reduced: { label: 'Reduced Pressure', color: '#f59e0b', icon: '⚠️' },
};

export default function OtwHazardPanel({ hazards, onSelectHydrant }: OtwHazardPanelProps) {
  const outCount     = hazards.filter((h) => h.status === 'out').length;
  const reducedCount = hazards.filter((h) => h.status === 'reduced').length;

  if (hazards.length === 0) {
    return (
      <div className="w-full pointer-events-auto overflow-hidden rounded-xl border border-neutral-200/60 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)] backdrop-blur dark:border-neutral-700/60 dark:bg-neutral-900 dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3.5 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/50">
          <span className="text-sm leading-none">🚒</span>
          <p className="text-xs font-bold text-neutral-700 dark:text-neutral-200 leading-none">En Route</p>
        </div>
        <p className="px-3.5 py-3 text-xs text-neutral-400 dark:text-neutral-500">No hazards along your route.</p>
      </div>
    );
  }

  return (
    <div className="w-full pointer-events-auto overflow-hidden rounded-xl border border-[#FED42E]/40 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.18)] backdrop-blur dark:bg-neutral-900 dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)]">

      {/* Header */}
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-[#FED42E]/10 px-3.5 py-2.5 dark:border-neutral-700">
        <span className="text-sm leading-none">⚠️</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-[#FED42E] leading-none">Route Hazards Detected</p>
          <p className="mt-0.5 text-[10px] leading-none text-neutral-500 dark:text-neutral-400">
            {outCount > 0 && `${outCount} out of service`}
            {outCount > 0 && reducedCount > 0 && ' · '}
            {reducedCount > 0 && `${reducedCount} reduced pressure`}
            {' '}near your route
          </p>
        </div>
      </div>

      {/* Hazard list — caps at ~2 rows, the rest scroll */}
      <ul className="max-h-[8.5rem] overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800">
        {hazards.map((h) => {
          const m = HAZARD_META[h.status] ?? HAZARD_META.reduced;
          return (
            <li key={h.id}>
              <button
                onClick={() => onSelectHydrant(h)}
                className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100 dark:hover:bg-neutral-800 dark:active:bg-neutral-700"
              >
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: m.color, boxShadow: `0 0 5px ${m.color}` }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100">
                    {h.name}
                  </p>
                  <p className="mt-0.5 text-[10px] font-semibold" style={{ color: m.color }}>
                    {m.icon} {m.label}
                  </p>
                  {h.hazard && h.hazard !== 'None' && (
                    <p className="mt-0.5 truncate text-[10px] text-neutral-400 dark:text-neutral-500">
                      {h.hazard}
                    </p>
                  )}
                </div>
                <span className="mt-0.5 shrink-0 text-[10px] font-mono text-neutral-400 dark:text-neutral-500">
                  {h.id}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="flex items-center gap-1 border-t border-neutral-100 bg-neutral-50 px-3.5 py-2 text-[10px] text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/50 dark:text-neutral-500">
        🚒 Tap a hydrant to view details and find an alternative
      </div>
    </div>
  );
}
