'use client';

import { useAuth } from '@/lib/auth-context';
import { useIsMobile } from '@/lib/use-media-query';
import { useRef, useState, useEffect, useCallback } from 'react';
import { type Hydrant, STATUS_META } from '../data/hydrants';

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
}

const PRESSURE_COLOR: Record<string, string> = {
  Strong:   '#2fbf4f',
  Moderate: '#f5a623',
  Low:      '#e05c2a',
  None:     '#9aa0a6',
};

export default function HydrantInfoPanel({ hydrant, onClose, onOpenFullDetails, onEdit, onReport, onFlyTo, onRoute, onRouteDismiss, isOtw }: HydrantInfoPanelProps) {
  const { role } = useAuth();
  const isMobile = useIsMobile();
  const meta = STATUS_META[hydrant.status];
  const canEdit   = role === 'authorized' || role === 'head' || role === 'admin';
  const canReport = role === 'authorized' || role === 'head' || role === 'admin';

  const panelRef  = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const dragStartY = useRef(0);
  const dragStartH = useRef(0);

  // Reset height when a different hydrant is selected
  useEffect(() => { setPanelHeight(null); }, [hydrant.id]);

  const onDragHandleDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = panelRef.current?.offsetHeight ?? 0;

    // MIN: always keep the bottom section + header + drag handle fully visible
    const bottomH  = bottomRef.current?.offsetHeight ?? 160;
    const headerH  = (panelRef.current?.children[1] as HTMLElement | undefined)?.offsetHeight ?? 60;
    const MIN_H    = bottomH + headerH + 12; // 12 = drag handle
    // MAX: don't let the panel consume more than 65% of the viewport height
    const MAX_H    = Math.floor(window.innerHeight * 0.65);

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - dragStartY.current; // positive = drag down = shrink
      setPanelHeight(Math.min(MAX_H, Math.max(MIN_H, dragStartH.current - delta)));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

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
        maxHeight: isMobile ? '80vh' : 'calc(100vh - 28rem)',
        ...(panelHeight !== null && !isMobile ? { height: panelHeight } : {}),
      }}
    >
      {/* Drag handle — top border, drag down to shrink */}
      <div
        onMouseDown={onDragHandleDown}
        className="shrink-0 flex items-center justify-center h-3 cursor-s-resize select-none bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
        title="Drag down to resize"
      >
        <span className="w-8 h-0.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
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

      {/* Lead photo — 1:1, scales with card width */}
      {hydrant.photos.length > 0 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hydrant.photos[0]}
          alt={`${hydrant.name} field photo`}
          className="aspect-square w-full min-h-0 shrink object-cover"
        />
      )}

      <div ref={bottomRef} className="shrink-0 px-5 py-4">
        {/* Status / Pressure / Key rows */}
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

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { onRoute(); onRouteDismiss(); }}
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
          className="mt-2 w-full text-center text-xs text-[#e0353b] dark:text-[#e0353b] hover:underline"
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
