'use client';

import { useState, useCallback } from 'react';
import { findNearestHydrants, type RankedHydrant, type NearestHydrantResult } from '../../../lib/nearest-hydrant';

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconLocation = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

interface NearestHydrantPanelProps {
  userPosition: { lat: number; lng: number } | null;
  onHydrantSelect: (hydrant: RankedHydrant | null) => void;
  selectedHydrantId?: string | null;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${metres} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

export default function NearestHydrantPanel({
  userPosition,
  onHydrantSelect,
  selectedHydrantId,
  isOpen,
  onOpen,
  onClose,
}: NearestHydrantPanelProps) {
  const [result, setResult] = useState<NearestHydrantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!userPosition) {
      setError('Enable GPS location first — click the locate button on the map.');
      onOpen();
      return;
    }
    setLoading(true);
    setError(null);
    onOpen();
    onHydrantSelect(null);
    try {
      const data = await findNearestHydrants(userPosition.lat, userPosition.lng);
      setResult(data);
      if (data.withinRadius.length > 0) {
        onHydrantSelect(data.withinRadius[0]);
      }
    } catch (err) {
      setError('Search failed. Please try again.');
      console.error('[NearestHydrantPanel]', err);
    } finally {
      setLoading(false);
    }
  }, [userPosition, onHydrantSelect, onOpen]);

  const handleClose = () => {
    setResult(null);
    setError(null);
    onHydrantSelect(null);
    onClose();
  };

  return (
    <div className="flex flex-col items-start gap-2" style={{ width: 280 }}>

      {/* ── Button — hidden while panel is open ── */}
      {!isOpen && (
        <button
          onClick={handleSearch}
          disabled={loading}
          className="pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all duration-150 ease-out hover:scale-[1.04] hover:shadow-[0_4px_14px_rgba(224,53,59,0.5)] active:scale-[0.96] active:duration-75 disabled:cursor-wait disabled:opacity-80"
          style={{ background: '#e0353b', whiteSpace: 'nowrap' }}
        >
          {loading ? (
            <>
              <span className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white anim-spin" />
              Searching…
            </>
          ) : (
            <>
              <IconSearch />
              Find Nearest Hydrant
            </>
          )}
        </button>
      )}

      {/* ── Result / Error panel ── */}
      {isOpen && (
        <div className="pointer-events-auto w-full overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900" style={{ border: '1px solid rgba(0,0,0,0.08)' }}>

          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-neutral-800 dark:text-neutral-100">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e0353b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Nearest Hydrants
              {result && <span className="font-normal text-neutral-400 dark:text-neutral-500">within 2 km</span>}
            </span>
            <button
              onClick={handleClose}
              className="flex items-center justify-center rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            >
              <IconClose />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
              <span>⚠️</span><span>{error}</span>
            </div>
          )}

          {/* No hydrants */}
          {result?.noHydrantsFound && !error && (
            <div className="px-4 py-5 text-center">
              <div className="mb-2 text-3xl">🚫</div>
              <p className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">No operational hydrants nearby</p>
              <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">Nothing within 2 km of your location.</p>
              {result.ranked.length > 0 && (
                <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                  Nearest is {formatDistance(result.ranked[0].sortDistance)} away.
                </p>
              )}
            </div>
          )}

          {/* Hydrant list */}
          {result && result.withinRadius.length > 0 && (
            <ul className="m-0 list-none p-0" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {result.withinRadius.map((hydrant, index) => {
                const isSelected = selectedHydrantId === hydrant.id;
                return (
                  <li key={hydrant.id} className="border-b border-neutral-100 dark:border-neutral-700/50 last:border-b-0">
                    <button
                      onClick={() => onHydrantSelect(hydrant)}
                      className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors duration-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 ${
                        isSelected ? 'border-l-2 border-[#e0353b] bg-red-50/50 dark:bg-red-950/20' : 'border-l-2 border-transparent'
                      }`}
                    >
                      {/* Rank bubble */}
                      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                        index === 0
                          ? 'bg-[#FED42E]/20 text-[#b89800]'
                          : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-700 dark:text-neutral-400'
                      }`}>
                        {index + 1}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-neutral-800 dark:text-neutral-100">
                          {hydrant.name}
                        </p>
                        {hydrant.area && (
                          <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{hydrant.area}</p>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <span className={`flex items-center gap-1 text-[11px] font-semibold ${index === 0 ? 'text-[#e0353b]' : 'text-neutral-500 dark:text-neutral-400'}`}>
                            <IconLocation />{formatDistance(hydrant.sortDistance)}
                          </span>
                          {hydrant.travelMetres !== null && (
                            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">walking est.</span>
                          )}
                        </div>
                      </div>

                      {/* Nearest badge */}
                      {index === 0 && (
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: '#FED42E', color: '#7a5c00' }}>
                          Nearest
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer */}
          {result && !result.noHydrantsFound && (
            <div className="flex items-center gap-1 border-t border-neutral-100 bg-neutral-50 px-4 py-2 text-[11px] text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-500">
              🗺 Distances via Mapbox walking isochrone
            </div>
          )}
        </div>
      )}
    </div>
  );
}
