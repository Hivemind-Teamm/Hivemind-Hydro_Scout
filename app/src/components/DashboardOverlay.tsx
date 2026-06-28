'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useIsMobile } from '@/lib/use-media-query';
import {
  STATUS_META,
  STATUS_ORDER,
  type HydrantStatus,
  type Hydrant,
} from '../data/hydrants';
import { HYDRANT_PIN_FILTER } from './hydrantIcon';
import OtwHazardPanel from './OtwHazardPanel';
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
  routeHazards?: Hydrant[];
  onSelectHazardHydrant?: (h: Hydrant) => void;
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
  routeHazards = [],
  onSelectHazardHydrant,
}: DashboardOverlayProps) {
  const { user, role } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const isMobile = useIsMobile();
  const canViewDashboard = role === 'head' || role === 'admin';
  const canPin = role === 'authorized' || role === 'head' || role === 'admin';
  const [showCounts] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [hazardPanelMinimized, setHazardPanelMinimized] = useState(false);

  // Reset minimized state when OTW mode changes
  useEffect(() => {
    if (!isOtw) setHazardPanelMinimized(false);
  }, [isOtw]);

  const displayName = user?.email ? user.email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Guest';
  const roleLabel: Record<string, string> = { admin: 'Admin', head: 'Head Inspector', authorized: 'Authorized', general: 'General' };
  const displayRole = roleLabel[role ?? ''] ?? 'Guest';

  const syncedLabel = loading
    ? 'Syncing…'
    : lastSynced
      ? `Synced · ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : 'Live · Synced';

  /* ======================== MOBILE LAYOUT ======================== */
  if (isMobile) {
    return (
      <div className="pointer-events-none absolute inset-0 select-none">
        {/* Slim top bar */}
        <header className="pointer-events-auto absolute inset-x-0 top-0 z-[1000]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="flex h-14 items-center justify-between bg-neutral-600/60 px-3 [backdrop-filter:blur(4px)] dark:bg-black/55">
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/Hydro-Scout%20Logo.png" alt="" className="h-9 w-9 object-contain dark:drop-shadow-[0_0_8px_rgba(224,53,59,0.7)]" />
              <span className="text-lg font-extrabold tracking-tight text-white">Hydro-<span className="text-[#e0353b]">Scout</span></span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${loading ? 'bg-amber-400' : 'bg-[#2fbf4f]'}`} />
              <button
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition-transform active:scale-90"
              >
                <MenuGlyph />
              </button>
            </div>
          </div>
          <div className="h-1 w-full" style={{ background: 'repeating-linear-gradient(to right, #FED42E 0px, #FED42E 70px, #e0353b 70px, #e0353b 140px)' }} />
        </header>

        {/* Search + horizontally-scrollable status pills — stays just below the header, above the OTW pill */}
        <div className="pointer-events-auto absolute inset-x-0 z-[1100] flex flex-row items-center gap-1.5 px-2 pt-2" style={{ top: 'calc(3.75rem + env(safe-area-inset-top, 0px))' }}>
          <LocationSearch onFlyTo={onFlyTo} mobile />
          <div className="shrink-0 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max overflow-hidden rounded-lg">
              {STATUS_ORDER.map((status) => {
                const meta = STATUS_META[status];
                const active = activeStatus === status;
                return (
                  <button
                    key={status}
                    onClick={() => onSelectStatus(status)}
                    className={`shrink-0 px-2 py-1 text-[10px] font-bold transition-all duration-150 ease-out active:scale-95 ${!active ? 'bg-white text-neutral-600 dark:bg-neutral-700 dark:text-neutral-100' : ''}`}
                    style={{
                      background: active ? meta.color : (!isDark ? '#ffffff' : undefined),
                      color:      active ? '#ffffff'  : (!isDark ? '#4b5563' : undefined),
                    }}
                  >
                    {meta.pillLabel}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* OTW hazard panel — bottom-left above nearest hydrant button, mobile only */}
        {isOtw && !hazardPanelMinimized && (
          <div className="pointer-events-auto absolute left-4 z-[1000] w-[17rem]" style={{ bottom: '5.5rem' }}>
            <div className="relative">
              <OtwHazardPanel hazards={routeHazards} onSelectHydrant={onSelectHazardHydrant ?? (() => {})} />
              <button
                onClick={() => setHazardPanelMinimized(true)}
                className="absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800/90 text-white shadow-lg backdrop-blur-sm border border-white/20"
                aria-label="Minimize hazards panel"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        )}
        {/* Minimized hazard tab — left edge pill that re-expands the panel */}
        {isOtw && hazardPanelMinimized && (
          <button
            onClick={() => setHazardPanelMinimized(false)}
            className="pointer-events-auto absolute left-0 z-[1000] flex flex-col items-center rounded-r-xl bg-amber-500/90 px-2 py-3 shadow-xl backdrop-blur-sm"
            style={{ bottom: '5.5rem' }}
            aria-label="Show hazards panel"
          >
            <span className="text-sm leading-none mb-1.5">⚠️</span>
            {routeHazards.length > 0 && (
              <span className="mb-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[9px] font-bold text-white">
                {routeHazards.length}
              </span>
            )}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}

        {/* Bottom-right FAB cluster — locate, reports, pin (zoom is pinch on touch) */}
        <div className="pointer-events-auto absolute bottom-6 right-4 z-[1000] flex flex-col items-end gap-3">
          {canPin && (
            <button
              aria-label={addHydrantMode ? 'Exit Add Hydrant mode' : 'Pin new hydrant'}
              onClick={onToggleAddHydrant}
              className="relative flex h-12 w-12 items-center justify-center transition-transform active:scale-90"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/Hydrant%20Pin%20Red.png" alt="Pin hydrant" className="h-12 w-12 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]" />
              <span className={`pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full font-extrabold text-white shadow ${addHydrantMode ? 'bg-[#e0353b] text-[10px]' : 'bg-[#2fbf4f] text-xs'}`}>
                {addHydrantMode ? '✕' : '+'}
              </span>
            </button>
          )}
          {role !== 'general' && role !== null && (
            <div className="relative">
              <ToolButton label="Reports" onClick={onToggleReports} rounded active={showReports} tooltipSide="left">
                <ReportGlyph />
              </ToolButton>
              {hasPendingReports && (
                <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#e0353b] text-[9px] font-bold text-white">!</span>
              )}
            </div>
          )}
          <ToolButton label="Go to my location" onClick={onLocate} rounded tooltipSide="left">
            <GpsGlyph />
          </ToolButton>
          {provider === 'mapbox' && (
            <ToolButton label={is3D ? 'Switch to 2D view' : 'Switch to 3D view'} onClick={onToggle3D} rounded active={is3D} tooltipSide="left">
              <ThreeDGlyph />
            </ToolButton>
          )}
        </div>

        {/* Slide-in menu drawer */}
        {mobileMenuOpen && (
          <>
            <div className="pointer-events-auto anim-fade absolute inset-0 z-[3500] bg-black/40" onClick={() => setMobileMenuOpen(false)} />
            <div className="anim-slide-right pointer-events-auto absolute inset-y-0 right-0 z-[3600] flex w-[82%] max-w-[20rem] flex-col bg-white shadow-2xl dark:bg-neutral-900">
              {/* User banner */}
              <div className="flex items-center gap-3 bg-[#e0353b] px-4 py-4">
                <button onClick={() => { setMobileMenuOpen(false); onOpenAccount(); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-transform active:scale-90">
                  <UserGlyph />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-white">{displayName}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-200">{displayRole}</p>
                </div>
                <button onClick={() => setMobileMenuOpen(false)} aria-label="Close menu" className="flex h-8 w-8 items-center justify-center rounded-full text-red-100 transition-transform active:scale-90">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              <div className="scroll-fade flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
                {/* AOR */}
                <MobileMenuRow
                  label="Area of Responsibility"
                  value="Diliman, QC"
                  onClick={() => { setMobileMenuOpen(false); onFlyTo(DILIMAN_CENTER.lat, DILIMAN_CENTER.lng, DEFAULT_ZOOM); }}
                  icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
                />
                {/* Data feed */}
                <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                  <span className="text-neutral-400 dark:text-neutral-500"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Data Feed</p>
                    <p className="flex items-center gap-1.5 text-sm font-bold text-neutral-700 dark:text-neutral-100">
                      <span className={`h-2 w-2 rounded-full ${loading ? 'bg-amber-400' : 'bg-[#2fbf4f]'}`} />{syncedLabel}
                    </p>
                  </div>
                </div>

                <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />

                {/* Live status counts / Route hazards (swaps during OTW) */}
                {isOtw ? (
                  <>
                    <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-amber-500">Route Hazards</p>
                    {routeHazards.length === 0 ? (
                      <p className="px-3 py-1.5 text-xs text-neutral-400 dark:text-neutral-500">No hazards along your route.</p>
                    ) : routeHazards.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => { setMobileMenuOpen(false); onSelectHazardHydrant?.(h); }}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg"
                      >
                        <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 truncate">{h.name}</span>
                        <span className="ml-2 shrink-0 text-xs font-bold" style={{ color: h.status === 'reduced' ? '#f59e0b' : '#9aa0a6' }}>
                          {h.status === 'reduced' ? 'Low Pressure' : 'Out of Service'}
                        </span>
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Live Count</p>
                    {STATUS_ORDER.map((status) => {
                      const meta = STATUS_META[status];
                      return (
                        <div key={status} className="flex items-center justify-between px-3 py-1.5">
                          <span className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={meta.iconUrl} alt="" width={16} height={21} style={{ filter: HYDRANT_PIN_FILTER, objectFit: 'contain' }} />
                            <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.legendLabel}</span>
                          </span>
                          <span className="text-sm font-bold tabular-nums text-neutral-700 dark:text-neutral-200">{counts[status]}</span>
                        </div>
                      );
                    })}
                  </>
                )}

                <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />

                {canViewDashboard && (
                  <MobileMenuRow label="Operations Dashboard" onClick={() => { setMobileMenuOpen(false); onOpenDashboard(); }} accent
                    icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>}
                  />
                )}
                {role === 'admin' && (
                  <MobileMenuRow label="Admin Dashboard" onClick={() => { setMobileMenuOpen(false); router.push('/admin'); }} accent
                    icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
                  />
                )}
                <MobileMenuRow label={provider === 'mapbox' ? 'Map: Satellite (Mapbox)' : 'Map: Streets (OSM)'} onClick={onToggleProvider}
                  icon={<MapGlyph />}
                />
                <MobileMenuRow label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} onClick={toggleTheme}
                  icon={isDark ? <SunGlyph /> : <MoonGlyph />}
                />
                <MobileMenuRow label="Account Center" onClick={() => { setMobileMenuOpen(false); onOpenAccount(); }}
                  icon={<UserGlyph />}
                />
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  /* ======================== DESKTOP LAYOUT ======================== */
  return (
    // Root is click-through; each widget re-enables pointer events so the map
    // underneath stays pannable/zoomable everywhere else.
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* ---------- Header ---------- */}
      <header className="pointer-events-auto absolute inset-x-0 top-0 z-[1000]">
        <div className="flex h-16 w-full items-stretch justify-between overflow-visible bg-neutral-600/60 pl-2 pr-4 [backdrop-filter:blur(4px)] dark:bg-black/55">
          {/* Logo + subtitle */}
          <div className="flex items-center gap-0 border-r border-white/15 pr-4">
            <Logo />
          </div>

          {/* Sheet / AOR */}
          <div className="flex flex-col justify-center border-r border-white/15 px-5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">Sheet</span>
            <button
              onClick={() => onFlyTo(DILIMAN_CENTER.lat, DILIMAN_CENTER.lng, DEFAULT_ZOOM)}
              className="mt-0.5 text-left text-xs font-bold text-white transition-colors hover:text-[#FED42E] active:scale-95"
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

          {/* Right side — stable ml-auto group to prevent layout shift */}
          <div className="ml-auto flex items-stretch">
            {/* Operations Dashboard button — head + admin */}
            {canViewDashboard && (
              <div className="flex items-center border-l border-white/15 px-5">
                <button
                  onClick={onOpenDashboard}
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all duration-150 ease-out hover:scale-[1.04] hover:shadow-[0_4px_14px_rgba(224,53,59,0.5)] active:scale-[0.96] active:duration-75"
                  style={{ background: '#e0353b' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                  Operations Dashboard
                </button>
              </div>
            )}

            {/* Admin Dashboard button — admin only */}
            {role === 'admin' && (
              <div className="flex items-center border-l border-white/15 px-5">
                <button
                  onClick={() => router.push('/admin')}
                  className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all duration-150 ease-out hover:scale-[1.04] hover:shadow-[0_4px_14px_rgba(224,53,59,0.5)] active:scale-[0.96] active:duration-75"
                  style={{ background: '#e0353b' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  Admin Dashboard
                </button>
              </div>
            )}

            {/* User info */}
            <div className="flex items-center gap-3 border-l border-white/15 pl-4 pr-1">
              <div className="flex flex-col justify-center">
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/45">{displayRole}</span>
                <span className="mt-0.5 text-xs font-bold text-white">{displayName}</span>
              </div>
              <button
                onClick={onOpenAccount}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e0353b] text-white transition-all duration-150 ease-out hover:scale-110 hover:shadow-[0_4px_14px_rgba(224,53,59,0.5)] active:scale-90 active:duration-75"
              >
                <UserGlyph />
              </button>
            </div>
          </div>
        </div>
        {/* brand accent line */}
        <div className="h-1 w-full" style={{ background: 'repeating-linear-gradient(to right, #FED42E 0px, #FED42E 70px, #e0353b 70px, #e0353b 140px)' }} />
      </header>

      {/* ---------- Search + status filter pills ---------- */}
      <div className="pointer-events-auto absolute left-4 top-[4.75rem] z-[1100] flex flex-wrap items-center gap-2">
        <LocationSearch onFlyTo={onFlyTo} />

        <div className="flex overflow-hidden rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
          {STATUS_ORDER.map((status) => {
            const meta = STATUS_META[status];
            const active = activeStatus === status;
            return (
              <button
                key={status}
                onClick={() => onSelectStatus(status)}
                className={`px-4 py-2 text-xs font-bold transition-all duration-150 ease-out hover:brightness-95 hover:scale-[1.04] active:scale-[0.96] active:duration-75 ${
                  !active ? 'dark:bg-neutral-700 dark:text-neutral-100' : ''
                }`}
                style={{
                  background: active ? meta.color : (!isDark ? '#ffffff' : undefined),
                  color:      active ? '#ffffff'   : (!isDark ? '#4b5563' : undefined),
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
      <div className="pointer-events-auto absolute left-4 top-[8.5rem] z-[1000]">
        <div className="flex flex-col overflow-hidden rounded-xl bg-white dark:bg-neutral-800 shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
          <ToolButton label="Zoom in" onClick={onZoomIn}>
            <PlusGlyph />
          </ToolButton>
          <div className="h-px w-full bg-neutral-200 dark:bg-neutral-700" />
          <ToolButton label="Zoom out" onClick={onZoomOut}>
            <MinusGlyph />
          </ToolButton>
        </div>
      </div>

      {/* Vertical toolbar — layers, reports, dashboard, then add hydrant at bottom */}
      <div className="pointer-events-auto absolute left-4 top-[14.875rem] z-[1000] flex flex-col gap-3">
        <ToolButton
          label={provider === 'mapbox' ? 'Switch to OSM map' : 'Switch to Mapbox'}
          onClick={onToggleProvider}
          rounded
        >
          <MapGlyph />
        </ToolButton>

        {role !== 'general' && role !== null && (
          <div className="relative">
            <ToolButton label="Reports" onClick={onToggleReports} rounded active={showReports}>
              <ReportGlyph />
            </ToolButton>
            {hasPendingReports && (
              <span className="pointer-events-none absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#e0353b] text-[9px] font-bold text-white">
                !
              </span>
            )}
          </div>
        )}

        {canPin && (
          <div className="group relative mt-1">
            <button
              aria-label={addHydrantMode ? 'Exit Add Hydrant mode' : 'Pin new hydrant'}
              onClick={onToggleAddHydrant}
              className="relative flex h-11 w-11 items-center justify-center transition-all duration-150 ease-out hover:scale-110 hover:drop-shadow-[0_4px_8px_rgba(224,53,59,0.5)] active:scale-90 active:duration-75"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Hydrant%20Pin%20Red.png"
                alt="Pin hydrant"
                className="h-12 w-12 object-contain"
              />
            </button>
            <span className={`pointer-events-none absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full font-extrabold text-white shadow ${addHydrantMode ? 'bg-[#e0353b] text-[9px]' : 'bg-[#2fbf4f] text-[11px]'}`}>
              {addHydrantMode ? '✕' : '+'}
            </span>
            <div className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-[9999] -translate-y-1/2 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-hover:[transition-delay:500ms]">
              <span className="block whitespace-nowrap rounded-lg bg-neutral-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-xl dark:bg-neutral-800 dark:ring-1 dark:ring-white/10">
                {addHydrantMode ? 'Exit Add Hydrant mode' : 'Pin new hydrant'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ---------- Bottom-right stack: action buttons + status panel ---------- */}
      <div className={`absolute bottom-6 right-6 z-[1000] flex flex-col items-end gap-3 ${isOtw ? 'w-72' : 'w-60'}`}>
        {/* GPS + 3D + theme buttons row — always visible */}
        <div className="pointer-events-auto flex gap-2">
          <ToolButton label="Go to my location" onClick={onLocate} rounded tooltipSide="top">
            <GpsGlyph />
          </ToolButton>
          {provider === 'mapbox' && (
            <ToolButton label={is3D ? 'Switch to 2D view' : 'Switch to 3D view'} onClick={onToggle3D} rounded active={is3D} tooltipSide="top">
              <ThreeDGlyph />
            </ToolButton>
          )}
          <ToolButton label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme} rounded tooltipSide="top">
            {isDark ? <SunGlyph /> : <MoonGlyph />}
          </ToolButton>
        </div>

        {isOtw ? (
          <OtwHazardPanel hazards={routeHazards} onSelectHydrant={onSelectHazardHydrant ?? (() => {})} />
        ) : showCounts && (
          <div className="pointer-events-auto w-full rounded-xl bg-white/95 dark:bg-neutral-900/95 p-4 shadow-[0_6px_24px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="mb-2 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-700 pb-2">
              <span className="text-sm font-bold text-neutral-800 dark:text-neutral-100">Status</span>
              <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">Live Count</span>
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
                      <span className="text-sm font-semibold" style={{ color: meta.color }}>
                        {meta.legendLabel}
                      </span>
                    </span>
                    <span className="text-sm font-bold tabular-nums text-neutral-700 dark:text-neutral-200">
                      {counts[status]}
                    </span>
                  </li>
                );
              })}
            </ul>
            {autoFallback && (
              <p className="mt-3 border-t border-neutral-200 dark:border-neutral-700 pt-2 text-[11px] text-[#e0353b] dark:text-[#e0353b]">
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

function LocationSearch({ onFlyTo, mobile = false }: { onFlyTo: (lat: number, lng: number, zoom?: number) => void; mobile?: boolean }) {
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
    <div ref={containerRef} className={mobile ? 'relative flex-1 min-w-0' : 'relative'}>
      <div className={`flex items-center gap-1.5 rounded-full bg-white dark:bg-neutral-700 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ${mobile ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}>
        {loading ? <SpinnerGlyph mobile={mobile} /> : <SearchGlyph mobile={mobile} />}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
          placeholder={mobile ? 'Search' : 'Search Location'}
          className={`${mobile ? 'w-full flex-1 min-w-0 text-xs' : 'w-44 text-sm'} bg-transparent text-neutral-700 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none`}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setOpen(false); }} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className={`absolute left-0 top-[calc(100%+6px)] z-[2000] ${mobile ? 'w-full' : 'w-80'} overflow-hidden rounded-xl bg-white dark:bg-neutral-800 shadow-[0_8px_32px_rgba(0,0,0,0.22)]`}>
          {results.map((r, i) => {
            const parts = r.display_name.split(', ');
            const title = parts[0];
            const subtitle = parts.slice(1, 4).join(', ');
            return (
              <li key={i}>
                <button
                  onClick={() => select(r)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-700 border-b border-neutral-100 dark:border-neutral-700 last:border-0"
                >
                  <svg className="mt-0.5 shrink-0 text-neutral-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{title}</p>
                    {subtitle && <p className="truncate text-xs text-neutral-400 dark:text-neutral-500">{subtitle}</p>}
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
  tooltipSide = 'right',
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  rounded?: boolean;
  tooltipSide?: 'right' | 'left' | 'top';
}) {
  const tooltipPos: Record<string, string> = {
    right: 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2',
    left:  'right-[calc(100%+8px)] top-1/2 -translate-y-1/2',
    top:   'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2',
  };

  return (
    <div className="group relative">
      <button
        aria-label={label}
        onClick={onClick}
        className={`flex h-11 w-11 items-center justify-center transition-all duration-150 ease-out active:scale-90 active:duration-75 ${
          rounded ? 'rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.35)] hover:shadow-[0_6px_22px_rgba(0,0,0,0.45)]' : ''
        } ${
          active
            ? 'bg-[#f5c20a] text-neutral-900 hover:scale-105 hover:brightness-105'
            : 'bg-white text-neutral-700 hover:scale-110 hover:bg-neutral-50 hover:shadow-md dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600 dark:hover:shadow-[0_4px_14px_rgba(0,0,0,0.5)]'
        }`}
      >
        {children}
      </button>
      <div
        className={`pointer-events-none absolute z-[9999] ${tooltipPos[tooltipSide]} opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-hover:[transition-delay:500ms]`}
      >
        <span className="block whitespace-nowrap rounded-lg bg-neutral-900/95 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-xl dark:bg-neutral-800 dark:ring-1 dark:ring-white/10">
          {label}
        </span>
      </div>
    </div>
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
        className="h-[3.25rem] w-[3.25rem] translate-y-1 object-contain dark:drop-shadow-[0_0_10px_rgba(224,53,59,0.7)]"
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

function SearchGlyph({ mobile = false }: { mobile?: boolean }) {
  const s = mobile ? 13 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" className="shrink-0 text-neutral-400" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function SpinnerGlyph({ mobile = false }: { mobile?: boolean }) {
  const s = mobile ? 13 : 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" className="shrink-0 animate-spin text-neutral-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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

function MapGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* Left panel */}
      <path d="M3 5 L9 3 L9 21 L3 19 Z" />
      {/* Center panel */}
      <path d="M9 3 L15 5 L15 19 L9 21 Z" />
      {/* Right panel */}
      <path d="M15 5 L21 3 L21 19 L15 21 Z" />
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
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...stroke}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MenuGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

/* Mobile menu-drawer row */
function MobileMenuRow({ label, value, icon, onClick, accent = false }: {
  label: string; value?: string; icon: React.ReactNode; onClick: () => void; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors active:bg-neutral-100 dark:active:bg-neutral-800"
    >
      <span className={accent ? 'text-[#e0353b]' : 'text-neutral-400 dark:text-neutral-500'}>{icon}</span>
      <span className="min-w-0 flex-1">
        {value && <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</span>}
        <span className={`block truncate text-sm font-bold ${accent ? 'text-[#e0353b]' : 'text-neutral-700 dark:text-neutral-100'}`}>{value ?? label}</span>
      </span>
    </button>
  );
}

