'use client';

import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-media-query';
import { useRef, useState, useEffect, useCallback } from 'react';
import { type Hydrant, STATUS_META } from '../data/hydrants';
import { proxiedPhotoUrl } from '@/lib/photo-url';
import { FiX } from 'react-icons/fi';

interface HydrantInfoPanelProps {
  hydrant: Hydrant;
  onClose: () => void;
  onOpenFullDetails: () => void;
  onEdit: () => void;
  onReport: () => void;
  onFlyTo: (lat: number, lng: number) => void;
  onRoute: () => void;
  onRouteDismiss: () => void;
  isOtw: boolean;
  /** True while the route is toggled on but the directions are still loading. */
  routeCalculating?: boolean;
  /** Forwarded to the inner scrollable div — used by the map scroll-mode gesture. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

const PRESSURE_COLOR: Record<string, string> = {
  Strong:   '#2fbf4f',
  Moderate: '#f5a623',
  Low:      '#e05c2a',
  None:     '#9aa0a6',
};

type FlashState = 'idle' | 'red1' | 'off1' | 'red2' | 'active';

export default function HydrantInfoPanel({
  hydrant, onClose, onOpenFullDetails, onEdit, onReport,
  onFlyTo, onRoute, onRouteDismiss, isOtw, routeCalculating = false, scrollRef,
}: HydrantInfoPanelProps) {
  const { role } = useAuth();
  const isMobile = useIsMobile();
  const meta = STATUS_META[hydrant.status];
  const canEdit   = role === 'head' || role === 'admin';
  const canReport = role === 'authorized' || role === 'head' || role === 'admin';
  // General users (and guests) are view-only — no routing.
  const canRoute  = role === 'authorized' || role === 'head' || role === 'admin';

  // Touch device (phone / tablet) = primary pointer is coarse (finger).
  // Desktop with a mouse = primary pointer is fine.
  // This is the right signal for "needs inner scroll" — screen width is unreliable
  // because iPads can be 1024 px+ wide yet still need touch-friendly scrolling.
  const [isTouchDevice, setIsTouchDevice] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const h = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  // Touch devices (mobile + tablet) get inner scroll; desktop mouse does not
  const hasInnerScroll = isTouchDevice;

  const panelRef  = useRef<HTMLDivElement>(null);
  const photoRef  = useRef<HTMLImageElement>(null);
  const infoRef   = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const dragStartY  = useRef(0);
  const dragStartH  = useRef(0);
  const lastTapTime = useRef(0);

  // Scale mode — persists until the user double-taps again to turn it off
  const scaleModeRef = useRef(false);
  const [scaleMode, setScaleMode] = useState(false);
  const [flash, setFlash] = useState<FlashState>('idle');

  // Reset everything when a new hydrant is selected
  useEffect(() => {
    // Deliberately resync local panel UI state to the newly selected hydrant.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPanelHeight(null);
    scaleModeRef.current = false;
    setScaleMode(false);
    setFlash('idle');
    lastTapTime.current = 0;
  }, [hydrant.id]);

  // Touch devices (mobile + tablet): scroll past the photo so info shows first.
  // User swipes up to reveal the full photo above.
  useEffect(() => {
    if (!scrollRef?.current || !isTouchDevice || hydrant.photos.length === 0) return;
    requestAnimationFrame(() => {
      if (!scrollRef?.current) return;
      scrollRef.current.scrollTop = photoRef.current?.offsetHeight ?? 0;
    });
  }, [hydrant.id, scrollRef, isTouchDevice]);

  // Flash animation played when scale mode is activated
  const runFlash = useCallback(() => {
    setFlash('red1');
    setTimeout(() => setFlash('off1'),  220);
    setTimeout(() => setFlash('red2'),  440);
    setTimeout(() => setFlash('active'), 660); // stays red until deactivated
  }, []);

  const onDragHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el      = e.currentTarget;
    const pid     = e.pointerId;
    const isTouch = e.pointerType !== 'mouse';
    const now     = Date.now();

    if (isTouch) {
      const elapsed    = now - lastTapTime.current;
      lastTapTime.current = now;
      const isDoubleTap = elapsed <= 1000;

      if (isDoubleTap) {
        if (scaleModeRef.current) {
          // Second double-tap → deactivate
          scaleModeRef.current = false;
          setScaleMode(false);
          setFlash('idle');
          return; // no drag on deactivation tap
        }
        // First double-tap → activate and fall through to start drag
        scaleModeRef.current = true;
        setScaleMode(true);
        runFlash();
      } else {
        // Single tap: only allow drag if scale mode is already on
        if (!scaleModeRef.current) return;
      }
    }

    // ── Start resize drag (mouse: always; touch: when scale mode is active) ──
    el.setPointerCapture(pid);
    dragStartY.current = e.clientY;
    dragStartH.current = panelRef.current?.offsetHeight ?? 0;

    // MIN keeps the info section (rows + buttons + "Open full details") always visible
    const headerH = (panelRef.current?.children[1] as HTMLElement | undefined)?.offsetHeight ?? 60;
    const infoH   = infoRef.current?.offsetHeight ?? 200;
    const MIN_H   = 20 + headerH + infoH; // drag handle + header + info
    const MAX_H   = Math.floor(window.innerHeight * 0.72);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      const delta = ev.clientY - dragStartY.current; // positive = drag down = shrink
      setPanelHeight(Math.min(MAX_H, Math.max(MIN_H, dragStartH.current - delta)));
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      // Scale mode intentionally stays ON — user double-taps again to turn it off
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [runFlash]);

  // ── Visual state ──
  const pillBg = flash === 'red1' || flash === 'red2'
    ? 'bg-[#e0353b]'
    : flash === 'active'
      ? 'bg-[#e0353b]/70'
      : 'bg-neutral-300 dark:bg-neutral-600';

  const handleBg = flash === 'red1' || flash === 'red2'
    ? 'bg-[#e0353b]/20 dark:bg-[#e0353b]/25'
    : flash === 'active'
      ? 'bg-[#e0353b]/10 dark:bg-[#e0353b]/15'
      : 'bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700';

  return (
    <div
      ref={panelRef}
      className={
        isMobile
          ? 'anim-slide-up pointer-events-auto absolute inset-x-0 bottom-0 z-[2000] flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-800'
          : 'anim-slide-up pointer-events-auto absolute bottom-6 left-4 z-[2000] flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-800'
      }
      style={{
        width:     isMobile ? '100%' : 'clamp(13rem, 22vw, 17rem)',
        maxHeight: isMobile ? '72dvh' : 'calc(100dvh - 16rem)',
        ...(panelHeight !== null ? { height: panelHeight } : {}),
      }}
    >
      {/* ── Drag handle ──
          Touch: double-tap (within 1 s) to activate scale mode (stays red).
                 Double-tap again to deactivate.
                 While active, any single drag resizes the panel.
          Mouse: drag activates resize immediately, no double-tap needed.
      */}
      <div
        onPointerDown={onDragHandlePointerDown}
        style={{ touchAction: 'none' }}
        className={`shrink-0 flex items-center justify-center h-5 select-none transition-colors cursor-s-resize ${handleBg}`}
        title={scaleMode ? 'Scale mode ON — double-tap to exit' : 'Double-tap to resize'}
      >
        <span className={`w-10 h-1 rounded-full transition-colors duration-150 ${pillBg}`} />
      </div>

      {/* ── Header ── */}
      <div className="flex shrink-0 items-start justify-between bg-neutral-50 dark:bg-neutral-700 px-5 pb-4">
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
          className="ml-2 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <FiX className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {/*
        ── Scrollable content (tablet + mobile only) ──
        DOM order: photo first (top), info section below.
        On tablet the effect above sets scrollTop = photo height so info
        is visible first; swiping UP reveals the photo.
        overscroll-contain prevents rubber-band past the last element.
        Desktop uses overflow-hidden (no inner scroll — resize instead).
      */}
      <div
        ref={scrollRef as React.RefObject<HTMLDivElement>}
        className={`flex-1 min-h-0 ${hasInnerScroll ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'}`}
      >
        {hydrant.photos.length > 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={photoRef}
            src={proxiedPhotoUrl(hydrant.photos[0], 1024)}
            alt={`${hydrant.name} field photo`}
            decoding="async"
            className="aspect-square w-full object-cover"
          />
        )}

        {/* Info section — MIN_H anchors to this so it's always visible */}
        <div ref={infoRef} className="px-5 pt-4 pb-3">
          <div className="mb-3 flex flex-col divide-y divide-neutral-100 dark:divide-neutral-600 rounded-lg bg-neutral-50 dark:bg-neutral-700">
            <div className="flex items-center justify-between px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Status</p>
              <p className="text-xs font-bold" style={{ color: meta.color }}>{meta.legendLabel}</p>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Pressure</p>
              <p className="text-xs font-bold" style={{ color: PRESSURE_COLOR[hydrant.pressure] ?? '#555' }}>{hydrant.pressure}</p>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Key</p>
              <p className="text-xs font-bold text-neutral-700 dark:text-neutral-200">{hydrant.key}</p>
            </div>
          </div>

          {(canRoute || canEdit || canReport) && (
          <div className="flex items-center gap-2">
            {canRoute && (
            <button
              onClick={() => { if (isOtw) { onRouteDismiss(); } else { onRoute(); } }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold text-white transition-colors ${isOtw ? 'bg-red-700 hover:bg-red-800 active:bg-red-900' : 'bg-[#e0353b] hover:bg-[#c42d32] active:bg-[#9e2428]'}`}
            >
              <RouteIcon />
              {isOtw ? 'Routing…' : 'Route'}
            </button>
            )}
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
          )}

          {routeCalculating && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#e0353b]">
              <span className="h-3 w-3 rounded-full border-2 border-[#e0353b]/30 border-t-[#e0353b] anim-spin" />
              Calculating route…
            </div>
          )}

          <button
            className="mt-2 w-full text-center text-xs text-[#e0353b] hover:underline"
            onClick={onOpenFullDetails}
          >
            Open full details →
          </button>
        </div>
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
