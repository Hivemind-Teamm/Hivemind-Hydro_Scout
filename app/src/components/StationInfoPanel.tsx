'use client';

import { FiMapPin, FiX } from 'react-icons/fi';
import type { MapUnitLocation } from '@/lib/map-unit-location';
import { useIsMobile } from '@/lib/use-media-query';

export default function StationInfoPanel({ location, onClose, onLocate }: {
  location: MapUnitLocation;
  onClose: () => void;
  onLocate: () => void;
}) {
  const isMobile = useIsMobile();
  const reported = location.updatedAt === null ? 'Unavailable' : new Date(location.updatedAt).toLocaleString();
  return (
    <section aria-label="Station details"
      onClick={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      className={isMobile
        ? 'anim-slide-up pointer-events-auto absolute inset-x-0 bottom-0 z-[2000] flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-800'
        : 'anim-slide-up pointer-events-auto absolute bottom-6 left-4 z-[2000] flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-800'}
      style={{ width: isMobile ? '100%' : 'clamp(13rem, 22vw, 17rem)', maxHeight: isMobile ? '72dvh' : 'calc(100dvh - 16rem)' }}>
      <div className="flex h-5 shrink-0 items-center justify-center bg-neutral-50 dark:bg-neutral-800" aria-hidden="true">
        <span className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-600" />
      </div>
      <div className="flex shrink-0 items-start justify-between bg-neutral-50 px-5 pb-4 dark:bg-neutral-700">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Fire station</p>
          <button type="button" onClick={onLocate} title="Zoom to station location"
            className="flex items-center gap-1 text-left text-base font-bold text-neutral-800 hover:underline dark:text-neutral-100">
            <FiMapPin className="h-4 w-4 shrink-0" />
            <span className="break-all">{location.stationId}</span>
          </button>
        </div>
        <button type="button" onClick={onClose} aria-label="Close station details"
          className="ml-2 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-600 dark:hover:text-neutral-200">
          <FiX className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="flex h-32 items-center justify-center bg-red-50 dark:bg-red-950/20" aria-hidden="true">
          <svg width="80" height="80" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="16" fill="#dc2626" />
            <path d="M9 15.5L18 9l9 6.5V26H9zM13 26v-7h10v7M15 18.5v-4h6v4M16 26v-3h4v3" fill="none" stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="space-y-3 p-5">
          <dl className="divide-y divide-neutral-100 rounded-lg bg-neutral-50 px-3 dark:divide-neutral-700 dark:bg-neutral-900/40">
            {[
              ['Last reported', reported],
              ['GPS accuracy', `${Math.round(location.accuracy)} m`],
              ['Latitude', location.lat.toFixed(5)],
              ['Longitude', location.lng.toFixed(5)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-3 py-2.5">
                <dt className="text-[10px] font-bold uppercase text-neutral-400">{label}</dt>
                <dd className="text-right text-xs font-semibold text-neutral-700 dark:text-neutral-200">{value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={onLocate} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#e0353b] py-2 text-xs font-bold text-white hover:bg-red-700">
            <FiMapPin className="h-4 w-4" /> View on map
          </button>
          <p className="text-center text-[11px] text-neutral-400">Latest reported device position</p>
        </div>
      </div>
    </section>
  );
}
