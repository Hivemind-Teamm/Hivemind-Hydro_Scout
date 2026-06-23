'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  STATUS_META,
  STATUS_ORDER,
  type HydrantStatus,
} from '../data/hydrants';

interface DashboardOverlayProps {
  activeStatus: HydrantStatus | null;
  onSelectStatus: (status: HydrantStatus) => void;
  counts: Record<HydrantStatus, number>;
  provider: 'mapbox' | 'leaflet';
  autoFallback: boolean;
  onToggleProvider: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  showReports: boolean;
  onToggleReports: () => void;
  onOpenAccount: () => void;
  onOpenDashboard: () => void;
  addHydrantMode: boolean;
  onToggleAddHydrant: () => void;
  hasPendingReports: boolean;
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
  showReports,
  onToggleReports,
  onOpenAccount,
  onOpenDashboard,
  addHydrantMode,
  onToggleAddHydrant,
  hasPendingReports,
}: DashboardOverlayProps) {
  const { user, role } = useAuth();
  const canViewDashboard = role === 'head' || role === 'admin';
  const canPin = role === 'authorized' || role === 'head' || role === 'admin';
  const [search, setSearch] = useState('');
  const [showCounts, setShowCounts] = useState(true);

  const displayName = user?.email ? user.email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Guest';

  return (
    // Root is click-through; each widget re-enables pointer events so the map
    // underneath stays pannable/zoomable everywhere else.
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* ---------- Header ---------- */}
      <header className="pointer-events-auto absolute inset-x-0 top-0 z-[1000]">
        <div className="flex h-16 items-center justify-between overflow-visible bg-black/50 pl-2 pr-5">
          <Logo />
          <button
            onClick={onOpenAccount}
            className="flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-all hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.45)] active:scale-95"
          >
            <span className="text-sm font-bold text-neutral-800">
              Welcome, {displayName}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#b11116] text-white">
              <UserGlyph />
            </span>
          </button>
        </div>
        {/* brand accent line */}
        <div className="h-1 w-full" style={{ background: 'repeating-linear-gradient(to right, #FED42E 0px, #FED42E 70px, #91191E 70px, #91191E 140px)' }} />
      </header>

      {/* ---------- Search + status filter pills ---------- */}
      <div className="pointer-events-auto absolute left-4 top-[76px] z-[1000] flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
          <SearchGlyph />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Location"
            className="w-44 bg-transparent text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
          />
        </div>

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

      {/* ---------- Live-count panel ---------- */}
      {showCounts && (
        <div className="pointer-events-auto absolute bottom-6 right-6 z-[1000] w-60 rounded-xl bg-white/95 p-4 shadow-[0_6px_24px_rgba(0,0,0,0.4)] backdrop-blur">
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
                    <Diamond color={meta.color} />
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
        width={100}
        height={100}
        className="h-[100px] w-[100px] translate-y-1 object-contain"
      />
      <span className="text-2xl font-extrabold tracking-tight text-white">
        Hydro-<span className="text-[#e0353b]">Scout</span>
      </span>
    </div>
  );
}

function Diamond({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect
        x="7"
        y="0.5"
        width="9.2"
        height="9.2"
        rx="1.6"
        transform="rotate(45 7 0.5)"
        fill={color}
      />
    </svg>
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
    <svg width="16" height="16" viewBox="0 0 24 24" className="text-neutral-400" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
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

function UserGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

