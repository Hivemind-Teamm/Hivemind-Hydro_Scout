'use client';

import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-media-query';
import { useRef, useState, useEffect, useCallback } from 'react';
import { type Hydrant, STATUS_META } from '../data/hydrants';
import { proxiedPhotoUrl } from '@/lib/photo-url';

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
  /** Ref forwarded to the inner scrollable content area (used by map scroll mode). */
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
  onFlyTo, onRoute, onRouteDismiss, isOtw, scrollRef,
}: HydrantInfoPanelProps) {
  const { role } = useAuth();
  const isMobile = useIsMobile();
  const meta = STATUS_META[hydrant.status];
  const canEdit   = role === 'authorized' || role === 'head' || role === 'admin';
  const canReport = role === 'authorized' || role === 'head' || role === 'admin';

  const panelRef        = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const dragStartY      = useRef(0);
  const dragStartH      = useRef(0);
  const resizeActiveRef = useRef(false);
  const longPressTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flash, setFlash] = useState<FlashState>('idle');

  useEffect(() => { setPanelHeight(null); setFlash('idle'); }, [hydrant.id]);

  const runFlash = useCallback(() => {
    // red → off → red → settle into "active" tint
    setFlash('red1');
    setTimeout(() => setFlash('off1'),  220);
    setTimeout(() => setFlash('red2'),  440);
    setTimeout(() => setFlash('active'), 660);
  }, []);

  const onDragHandlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el  = e.currentTarget;
    const pid = e.pointerId;

    dragStartY.current = e.clientY;
    dragStartH.current = panelRef.current?.offsetHeight ?? 0;

    const headerEl = panelRef.current?.children[1] as HTMLElement | undefined;
    const headerH  = headerEl?.offsetHeight ?? 60;
    const MIN_H    = headerH + 20;
    const MAX_H    = Math.floor(window.innerHeight * 0.72);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid || !resizeActiveRef.current) return;
      const delta = ev.clientY - dragStartY.current;
      setPanelHeight(Math.min(MAX_H, Math.max(MIN_H, dragStartH.current - delta)));
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      resizeActiveRef.current = false;
      setFlash('idle');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);

    if (e.pointerType === 'mouse') {
      // Desktop mouse: activate immediately, no long-press needed
      el.setPointerCapture(pid);
      resizeActiveRef.current = true;
      setFlash('active');
    } else {
      // Touch / pen: require a 2-second hold to activate resize
      longPressTimer.current = setTimeout(() => {
        el.setPointerCapture(pid);
        resizeActiveRef.current = true;
        dragStartY.current = e.clientY;
        dragStartH.current = panelRef.current?.offsetHeight ?? 0;
        runFlash();
      }, 2000);
    }
  }, [runFlash]);

  const pillColor = flash === 'red1' || flash === 'red2'
    ? '#e0353b'
    : flash === 'active'
      ? '#e0353b99'
      : undefined;

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
          ? 'anim-slide-up pointer-events-auto absolute inset-x-0 bottom-0 z-[2000] flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-900'
          : 'anim-slide-up pointer-events-auto absolute bottom-0 left-4 z-[2000] flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900'
      }
      style={{
        width: isMobile ? '100%' : 'clamp(13rem, 22vw, 17rem)',
        maxHeight: isMobile ? '72dvh' : 'calc(100dvh - 16rem)',
        ...(panelHeight !== null ? { height: panelHeight } : {}),
      }}
    >
      {/* Drag handle — hold 2 s on touch to activate resize */}
      <div
        onPointerDown={onDragHandlePointerDown}
        style={{ touchAction: 'none' }}
        className={`shrink-0 flex items-center justify-center h-5 cursor-s-resize select-none transition-colors ${handleBg}`}
        title="Hold 2 s to resize"
      >
        <span
          className={`w-8 h-0.5 rounded-full transition-colors duration-150 ${!pillColor ? 'bg-neutral-300 dark:bg-neutral-600' : ''}`}
          style={pillColor ? { background: pillColor } : undefined}
        />
      </div>

      {/* Header */}
      <div className="flex shrink-0 items-start justify-between bg-neutral-50 dark:bg-neutral-800 px-5 pb-4">
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
          className="ml-2 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-lg text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content area — photo + info rows + action buttons */}
      <div
        ref={scrollRef as React.RefObject<HTMLDivElement>}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {hydrant.photos.length > 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proxiedPhotoUrl(hydrant.photos[0])}
            alt={`${hydrant.name} field photo`}
            className={`w-full object-cover ${isMobile ? 'max-h-36' : 'aspect-square'}`}
          />
        )}

        <div className="px-5 py-4">
          <div className="mb-3 flex flex-col divide-y divide-neutral-100 dark:divide-neutral-700 rounded-lg bg-neutral-50 dark:bg-neutral-800">
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => { if (isOtw) { onRouteDismiss(); } else { onRoute(); } }}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold text-white transition-colors ${isOtw ? 'bg-red-700 hover:bg-red-800 active:bg-red-900' : 'bg-[#e0353b] hover:bg-[#c42d32] active:bg-[#9e2428]'}`}
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
