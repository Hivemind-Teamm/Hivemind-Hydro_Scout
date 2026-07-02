'use client';

import { FiX } from 'react-icons/fi';

interface LocationPreviewPanelProps {
  lat: number;
  lng: number;
  address: string;
  onPinHydrant: () => void;
  onDismiss: () => void;
}

export default function LocationPreviewPanel({ lat, lng, address, onPinHydrant, onDismiss }: LocationPreviewPanelProps) {
  const isLoading = address === 'Loading…';

  return (
    <div className="anim-slide-up pointer-events-auto absolute bottom-6 left-4 z-[2000] w-72 overflow-hidden rounded-xl bg-white dark:bg-neutral-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 bg-[#e0353b] px-4 py-3">
        <PinIcon />
        <span className="flex-1 text-sm font-bold text-white">New Hydrant Location</span>
        <button
          onClick={onDismiss}
          className="flex items-center justify-center rounded-full p-0.5 text-red-200 hover:bg-red-800 hover:text-white"
          aria-label="Dismiss"
        >
          <FiX className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <CoordField label="Latitude"  value={lat.toFixed(6)} />
          <CoordField label="Longitude" value={lng.toFixed(6)} />
        </div>
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Address</p>
          <p className={`text-xs leading-snug ${isLoading ? 'italic text-neutral-400 dark:text-neutral-500' : 'text-neutral-700 dark:text-neutral-200'}`}>
            {address}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-2 border-t border-neutral-100 px-4 py-3 dark:border-neutral-700">
        <button
          onClick={onDismiss}
          className="flex-1 rounded-lg border border-neutral-200 py-2 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          onClick={onPinHydrant}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#e0353b] py-2 text-xs font-bold text-white hover:bg-[#c42d32]"
        >
          <PinIcon small /> Pin Hydrant Here
        </button>
      </div>
    </div>
  );
}

function CoordField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">{label}</p>
      <p className="font-mono text-xs font-bold text-neutral-700 dark:text-neutral-200">{value}</p>
    </div>
  );
}

function PinIcon({ small = false }: { small?: boolean }) {
  const size = small ? 12 : 16;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="text-white">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
