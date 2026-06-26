'use client';

import { useAuth } from '@/lib/auth-context';
import { type Hydrant, STATUS_META } from '../data/hydrants';

interface HydrantInfoPanelProps {
  hydrant: Hydrant;
  onClose: () => void;
  onOpenFullDetails: () => void;
  onEdit: () => void;
  onReport: () => void;
  onFlyTo: (lat: number, lng: number) => void;
  onRoute: () => void;
  isOtw: boolean;
  otwMeta?: { distanceM: number; durationS: number } | null;
}

const PRESSURE_COLOR: Record<string, string> = {
  Strong:   '#2fbf4f',
  Moderate: '#f5a623',
  Low:      '#e05c2a',
  None:     '#9aa0a6',
};

function formatDist(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function formatEta(s: number) {
  return s < 60 ? `${s}s` : `${Math.round(s / 60)} min ETA`;
}

export default function HydrantInfoPanel({ hydrant, onClose, onOpenFullDetails, onEdit, onReport, onFlyTo, onRoute, isOtw, otwMeta }: HydrantInfoPanelProps) {
  const { role } = useAuth();
  const meta = STATUS_META[hydrant.status];
  const canEdit   = role === 'authorized' || role === 'head' || role === 'admin';
  const canReport = role === 'authorized' || role === 'head' || role === 'admin';

  return (
    <div
      className="anim-slide-up pointer-events-auto absolute bottom-6 left-4 z-[2000] w-80 overflow-hidden rounded-xl bg-white dark:bg-neutral-900 shadow-2xl"
      style={{ maxHeight: 'calc(100vh - 65px - 24px)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between bg-neutral-50 dark:bg-neutral-800 px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{hydrant.id}</p>
          <button
            onClick={() => onFlyTo(hydrant.lat, hydrant.lng)}
            className="flex items-center gap-1 text-left text-base font-bold text-neutral-800 dark:text-neutral-100 hover:underline"
            title="Zoom to hydrant"
          >
            <LocateIcon />
            {hydrant.name}
          </button>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="ml-2 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      {/* Lead photo */}
      {hydrant.photos.length > 0 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hydrant.photos[0]}
          alt={`${hydrant.name} field photo`}
          className="aspect-square w-full object-cover"
        />
      )}

      <div className="px-5 py-4">
        {/* Status / Pressure / Key row */}
        <div className="mb-3 grid grid-cols-3 divide-x divide-neutral-100 dark:divide-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800 py-2 text-center">
          <div className="px-2">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Status</p>
            <p className="text-xs font-bold" style={{ color: meta.color }}>{meta.legendLabel}</p>
          </div>
          <div className="px-2">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Pressure</p>
            <p className="text-xs font-bold" style={{ color: PRESSURE_COLOR[hydrant.pressure] ?? '#555' }}>
              {hydrant.pressure}
            </p>
          </div>
          <div className="px-2">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Key</p>
            <p className="text-xs font-bold text-neutral-700 dark:text-neutral-200">{hydrant.key}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRoute}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold text-white transition-colors ${isOtw ? 'bg-red-700 hover:bg-red-800 active:bg-red-900' : 'bg-[#91191E] hover:bg-[#7a1419] active:bg-[#611014]'}`}
          >
            <RouteIcon />
            {isOtw ? 'Routing…' : 'Route'}
          </button>
          {canEdit && (
            <button
              title="Edit hydrant"
              onClick={onEdit}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <EditIcon />
            </button>
          )}
          {canReport && (
            <button
              title="Report issue"
              onClick={onReport}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 dark:border-neutral-700 text-[#f5a623] hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <WarnIcon />
            </button>
          )}
        </div>

        {/* ETA / road distance strip — visible while routing is active */}
        {isOtw && otwMeta && (
          <div className="mt-2 flex items-center justify-center gap-3 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-400">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              {formatDist(otwMeta.distanceM)}
            </span>
            <span className="h-3 w-px bg-red-200 dark:bg-red-800" />
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              {formatEta(otwMeta.durationS)}
            </span>
            <span className="text-[10px] text-neutral-400 dark:text-neutral-500">via road</span>
          </div>
        )}

        {/* Loading ETA indicator */}
        {isOtw && !otwMeta && (
          <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-800 px-3 py-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-red-500" />
            <span className="text-xs text-neutral-400">Calculating route…</span>
          </div>
        )}

        <button
          className="mt-2 w-full text-center text-xs text-[#91191E] dark:text-[#e0353b] hover:underline"
          onClick={onOpenFullDetails}
        >
          Open full details →
        </button>
      </div>
    </div>
  );
}

/* ---- inline icons ---- */
const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

function RouteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" {...s}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...s}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...s}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function LocateIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" {...s}>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}
