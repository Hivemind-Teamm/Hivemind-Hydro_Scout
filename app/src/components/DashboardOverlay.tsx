'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  STATUS_META,
  STATUS_ORDER,
  type HydrantStatus,
} from '../data/hydrants';
import { HYDRANT_PIN_FILTER } from './hydrantIcon';
import { DILIMAN_CENTER, DEFAULT_ZOOM } from './mapConfig';

interface DashboardOverlayProps {
  activeStatus: HydrantStatus | null;
  onSelectStatus: (status: HydrantStatus) => void;
  counts: Record<HydrantStatus, number>;
  provider: 'mapbox' | 'leaflet';
  autoFallback: boolean;
  onToggleProvider: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onLocate: () => void;
  onToggle3D: () => void;
  is3D: boolean;
  showReports: boolean;
  onToggleReports: () => void;
  onOpenAccount: () => void;
  onOpenDashboard: () => void;
  addHydrantMode: boolean;
  onToggleAddHydrant: () => void;
  hasPendingReports: boolean;
  onFlyTo: (lat: number, lng: number, zoom?: number) => void;
  loading?: boolean;
  lastSynced?: Date | null;
  isOtw?: boolean;
}

export default function DashboardOverlay({
  activeStatus,
  onSelectStatus,
  counts,
  provider,
  autoFallback,
  onToggleProvider,
  onZoomIn,
  onZoomOut,
  onLocate,
  onToggle3D,
  is3D,
  showReports,
  onToggleReports,
  onOpenAccount,
  onOpenDashboard,
  addHydrantMode,
  onToggleAddHydrant,
  hasPendingReports,
  onFlyTo,
  loading = false,
  lastSynced = null,
  isOtw = false,
}: DashboardOverlayProps) {
  const { user, role } = useAuth();
  const canViewDashboard = role === 'head' || role === 'admin';
  const canPin = role === 'authorized' || role === 'head' || role === 'admin';
  const [showCounts, setShowCounts] = useState(true);

  const displayName = user?.email ? user.email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Guest';
  const roleLabel: Record<string, string> = { admin: 'Admin', head: 'Head Inspector', authorized: 'Authorized', general: 'General' };
  const displayRole = roleLabel[role ?? ''] ?? 'Guest';

  const syncedLabel = loading
    ? 'Syncing…'
    : lastSynced
      ? `Synced · ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : 'Live · Synced';

  return (
    // Root is click-through; each widget re-enables pointer events so the map
    // underneath stays pannable/zoomable everywhere else.
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* ---------- Header ---------- */}
      <header className="pointer-events-auto absolute inset-x-0 top-0 z-[1000]">
        <div className="flex h-16 items-stretch justify-between overflow-visible bg-black/70 pl-2 pr-4">
          {/* Logo + subtitle */}
          <div className="flex items-center gap-0 border-r border-white/15 pr-4">
            <Logo />
          </div>

          {/* Sheet / AOR */}
          <div className="flex flex-col justify-center border-r border-white/15 px-5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">Sheet</span>
            <button
              title="Return to Diliman, Quezon City"
              onClick={() => onFlyTo(DILIMAN_CENTER.lat, DILIMAN_CENTER.lng, DEFAULT_ZOOM)}
              className="mt-0.5 text-left text-xs font-bold text-white transition-colors hover:text-[#FED42E]"
            >
              AOR · Diliman, QC
            </button>
          </div>

          {/* Sync status + timestamp */}
          <div className="flex flex-col justify-center border-r border-white/15 px-5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">Data Feed</span>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${loading ? 'bg-amber-400' : 'bg-[#2fbf4f]'}`} />
              <span className="text-xs font-bold text-white">{syncedLabel}</span>
            </div>
          </div>

          {/* Authorized / user */}
          <div className="ml-auto flex flex-col justify-center border-l border-white/15 pl-5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">{displayRole}</span>
            <button
              onClick={onOpenAccount}
              className="mt-0.5 flex items-center gap-2 transition-opacity hover:opacity-80"
            >
              <span className="text-xs font-bold text-white">{displayName}</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#b11116] text-white">
                <UserGlyph />
              </span>
            </button>
          </div>
        </div>
        {/* brand accent line */}
        <div className="h-1 w-full" style={{ background: 'repeating-linear-gradient(to right, #FED42E 0px, #FED42E 70px, #91191E 70px, #91191E 140px)' }} />
      </header>

      {/* ---------- Search + status filter pills ---------- */}
      <div className="pointer-events-auto absolute left-4 top-[76px] z-[1100] flex flex-wrap items-center gap-2">
        <LocationSearch onFlyTo={onFlyTo} />

        <div className="flex overflow-hidden rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
          {STATUS_ORDER.map((status) => {
            const meta = STATUS_META[status];
            const active = activeStatus === status;
            return (
              <button
                key={status}
                onClick={() => onSelectStatus(status)}
                className="px-4 py-2 text-xs font-bold transition-all hover:brightness-90 active:scale-95"
                style={{
                  background: active ? meta.color : '#ffffff',
                  color: active ? '#ffffff' : '#4b5563',
                }}
              >
                {meta.pillLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------- Left toolbar ---------- */}

      {/* Zoom buttons under the search bar */}
      <div className="pointer-events-auto absolute left-4 top-[136px] z-[1000]">
        <div className="flex flex-col overflow-hidden rounded-xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
          <ToolButton label="Zoom in" onClick={onZoomIn}>
            <PlusGlyph />
          </ToolButton>
          <div className="h-px w-full bg-neutral-200" />
          <ToolButton label="Zoom out" onClick={onZoomOut}>
            <MinusGlyph />
          </ToolButton>
        </div>
      </div>

      {/* Vertical toolbar — layers, reports, dashboard, then add hydrant at bottom */}
      <div className="pointer-events-auto absolute left-4 top-[238px] z-[1000] flex flex-col gap-3">
        <ToolButton
          label={provider === 'mapbox' ? 'Switch to OSM map' : 'Switch to Mapbox'}
          onClick={onToggleProvider}
          active
          rounded
        >
          <LayersGlyph />
        </ToolButton>

        <div className="relative">
          <ToolButton label="Reports" onClick={onToggleReports} rounded active={showReports}>
            <ReportGlyph />
          </ToolButton>
          {hasPendingReports && (
            <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#91191E] text-[9px] font-bold text-white">
              !
            </span>
          )}
        </div>

        {canViewDashboard && (
          <ToolButton label="Operations Dashboard" onClick={onOpenDashboard} rounded>
            <StatsGlyph />
          </ToolButton>
        )}

        {canPin && (
          <div className="relative mt-1">
            <button
              title={addHydrantMode ? 'Exit Add Hydrant mode' : 'Pin new hydrant'}
              onClick={onToggleAddHydrant}
              className="relative flex h-11 w-11 items-center justify-center transition-all hover:opacity-90 active:scale-95"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Hydrant%20Pin%20Red.png"
                alt="Pin hydrant"
                className="h-12 w-12 object-contain"
              />
            </button>
            <span className={`pointer-events-none absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full font-extrabold text-white shadow ${addHydrantMode ? 'bg-[#91191E] text-[9px]' : 'bg-[#2fbf4f] text-[11px]'}`}>
              {addHydrantMode ? '✕' : '+'}
            </span>
          </div>
        )}
      </div>

      {/* ---------- Bottom-right stack: action buttons + status panel ---------- */}
      <div className="absolute bottom-6 right-6 z-[1000] flex w-60 flex-col items-end gap-3">
        {/* GPS + 3D buttons row — always visible */}
        <div className="pointer-events-auto flex gap-2">
          <ToolButton label="Go to my location" onClick={onLocate} rounded>
            <GpsGlyph />
          </ToolButton>
          {provider === 'mapbox' && (
            <ToolButton label={is3D ? 'Switch to 2D view' : 'Switch to 3D view'} onClick={onToggle3D} rounded active={is3D}>
              <ThreeDGlyph />
            </ToolButton>
          )}
        </div>

        {showCounts && (
          <div className="pointer-events-auto w-full rounded-xl bg-white/95 p-4 shadow-[0_6px_24px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="mb-2 flex items-center justify-between border-b border-neutral-200 pb-2">
              <span className="text-sm font-bold text-neutral-800">Status</span>
              <span className="text-xs font-medium text-neutral-400">Live Count</span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {STATUS_ORDER.map((status) => {
                const meta = STATUS_META[status];
                return (
                  <li key={status} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={meta.iconUrl}
                        alt={meta.legendLabel}
                        width={20}
                        height={26}
                        style={{ filter: HYDRANT_PIN_FILTER, objectFit: 'contain' }}
                      />
                      <span
                        className="text-sm font-semibold"
                        style={{ color: meta.color }}
                      >
                        {meta.legendLabel}
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-neutral-700">
                      {counts[status]}
                    </span>
                  </li>
                );
              })}
            </ul>
            {autoFallback && (
              <p className="mt-3 border-t border-neutral-200 pt-2 text-[11px] text-[#b11116]">
                Mapbox unavailable — showing OpenStreetMap.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Location search                                                   */
/* ---------------------------------------------------------------- */

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

function LocationSearch({ onFlyTo }: { onFlyTo: (lat: number, lng: number, zoom?: number) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced geocode fetch
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=ph`,
          { headers: { 'Accept-Language': 'en' } },
        );
        const data = await res.json() as NominatimResult[];
        setResults(data);
        setOpen(data.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (r: NominatimResult) => {
    onFlyTo(parseFloat(r.lat), parseFloat(r.lon), 16);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
        {loading ? <SpinnerGlyph /> : <SearchGlyph />}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
          placeholder="Search Location"
          className="w-44 bg-transparent text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} className="text-neutral-400 hover:text-neutral-600">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute left-0 top-[calc(100%+6px)] z-[2000] w-80 overflow-hidden rounded-xl bg-white shadow-[0_8px_32px_rgba(0,0,0,0.22)]">
          {results.map((r, i) => {
            const parts = r.display_name.split(', ');
            const title = parts[0];
            const subtitle = parts.slice(1, 4).join(', ');
            return (
              <li key={i}>
                <button
                  onClick={() => select(r)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 border-b border-neutral-100 last:border-0"
                >
                  <svg className="mt-0.5 shrink-0 text-neutral-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-800">{title}</p>
                    {subtitle && <p className="truncate text-xs text-neutral-400">{subtitle}</p>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Small presentational helpers                                      */
/* ---------------------------------------------------------------- */

function ToolButton({
  children,
  label,
  onClick,
  active = false,
  rounded = false,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  rounded?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center transition-all active:scale-90 ${
        rounded ? 'rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.35)]' : ''
      } ${active ? 'bg-[#f5c20a] text-neutral-900 hover:brightness-90' : 'bg-white text-neutral-600 hover:bg-neutral-100 hover:scale-105'}`}
    >
      {children}
    </button>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/Hydro-Scout%20Logo.png"
        alt="Hydro-Scout"
        width={52}
        height={52}
        className="h-[52px] w-[52px] translate-y-1 object-contain"
      />
      <span className="text-2xl font-extrabold tracking-tight text-white">
        Hydro-<span className="text-[#e0353b]">Scout</span>
      </span>
    </div>
  );
}


/* Inline icon glyphs (no icon dependency in the project) */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0 text-neutral-400" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function SpinnerGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="shrink-0 animate-spin text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function MinusGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function LayersGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <polygon points="12 2 22 8 12 14 2 8 12 2" />
      <polyline points="2 16 12 22 22 16" />
    </svg>
  );
}

function ReportGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function StatsGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <line x1="6" y1="20" x2="6" y2="12" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="9" />
    </svg>
  );
}

function ThreeDGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function GpsGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function UserGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

